import { inject, Injectable } from "@angular/core";
import { MapIds } from "../../constants/map-colors";
import { originalMapPalette } from "../../constants/map-palettes/original-palette";
import { BlockPaletteEntry, Chunk, ChunkSection } from "../../models/chunk";
import { ChunkMapData } from "../../models/chunk-map-data";
import { Coords } from "../../models/coords";
import { LevelChunk } from "../../models/level-chunk";
import { MapPalette } from "../../models/map-palette";
import {
  CommonCompressionFormat,
  DecompressionService
} from "../decompression/decompression-service";
import { NBTService } from "../nbt/nbt-service";

@Injectable({
  providedIn: "root"
})
export class AnvilService {
  public static readonly BLOCKS_IN_CHUNK = 16;
  public static readonly CHUNKS_IN_REGION = 32;
  public static readonly BIT_IN_HEIGHTMAP_ENTRY = 9;
  public static readonly PADDED_HEIGHTMAP_LENGTH = 37;

  private readonly decompressionService = inject(DecompressionService);
  private readonly NBTService = inject(NBTService);

  /**
   * Returns the coordinates of a chunk in the world given
   * the corrdiantes of a block in the world.
   */
  worldBlockCoordsToChunkCoords(blockX: number, blockZ: number): Coords {
    return new Coords(Math.floor(blockX / 16), Math.floor(blockZ / 16));
  }

  /**
   * Returns the coordinates of a chunk in its region given the
   * coordinates of the chunk in the world.
   */
  worldChunkCoordsToRegionChunkCoords(chunkX: number, chunkZ: number): Coords {
    let regionChunkX = chunkX % 32;
    if (regionChunkX < 0) {
      regionChunkX += 32;
    }
    let regionChunkZ = chunkZ % 32;
    if (regionChunkZ < 0) {
      regionChunkZ += 32;
    }
    return new Coords(regionChunkX, regionChunkZ);
  }

  /**
   * Returns the coordinates of a region given the
   * coordinates of a chunk in the world.
   */
  worldChunkCoordsToRegionCoords(chunkX: number, chunkZ: number): Coords {
    return new Coords(Math.floor(chunkX / 32), Math.floor(chunkZ / 32));
  }

  /**
   * Gets the data of a chunk given the data of an anvil file and
   * the coordinates of a chunk in the region.
   */
  async getChunkData(
    anvilData: ArrayBuffer,
    chunkX: number,
    chunkZ: number,
    yMin: number
  ): Promise<Chunk | undefined> {
    try {
      if (chunkX < 0 || chunkX > 31 || chunkZ < 0 || chunkZ > 31) {
        throw new Error(
          `Invalid argument: x: ${chunkX}, z: ${chunkZ}. The ranges for x and z are [0,31].`
        );
      }

      const dataView = new DataView(anvilData);

      const locationOffset = 4 * ((chunkX % 32) + (chunkZ % 32) * 32);
      const payloadOffset = (dataView.getUint32(locationOffset) >> 8) * 4096;
      const payloadSectorCount = dataView.getUint8(locationOffset + 3);

      // const timestampOffset = locationOffset + 4096;
      // const payloadTimestamp = dataView.getUint32(timestampOffset);

      /**
       * "If a chunk isn't present in the region file (e.g. because it
       * hasn't been generated or migrated yet), both fields are zero."
       */
      if (payloadOffset === 0 || payloadSectorCount === 0) {
        return undefined;
      }

      /**
       * "Chunk data begins with a (big-endian) four-byte signed length field that
       * indicates the exact length of the remaining chunk data in bytes."
       * Minus 1 for the compression type byte. The remaining bytes are the
       * compressed data.
       */
      const dataLength = dataView.getInt32(payloadOffset) - 1;

      const compressedData = dataView.buffer.slice(
        payloadOffset + 5,
        payloadOffset + 5 + dataLength
      );

      /**
       * (1) gzip (RFC1952) (unused in practice)
       * (2) zlib (RFC1950)
       * (3) Uncompressed (older versions)
       * (4) LZ4
       * (127) Custom
       */
      const compressionType = dataView.getUint8(payloadOffset + 4);
      let compressionFormat: CommonCompressionFormat | undefined = undefined;
      if (compressionType === 1) {
        compressionFormat = "gzip";
      } else if (compressionType === 2) {
        compressionFormat = "deflate";
      } else if (compressionType === 4) {
        compressionFormat = "lz4";
      } else if (compressionType !== 3) {
        throw new Error(
          `Invalid compression type: ${compressionType}. Custom compression is not supported.`
        );
      }

      const decompressedData = compressionFormat
        ? await this.decompressionService.decompressData(
            compressedData,
            compressionFormat
          )
        : compressedData;

      const chunk = this.NBTService.getSNBT(decompressedData);

      /**
       * Check if chunk is following the pre 1.18 format and convert if necessary.
       */
      if (chunk["Level"]) {
        return this.convertLevelChunk(chunk as LevelChunk);
      } else {
        chunk["yMin"] = yMin;
        return chunk as Chunk;
      }
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  /**
   * Chunks before 1.18 were in a different format.
   * This method converts a chunk in the level format to
   * a modern chunk format.
   */
  private convertLevelChunk(levelChunk: LevelChunk): Chunk {
    const sections: ChunkSection[] = [];
    for (const section of levelChunk.Level.Sections) {
      const newSection: ChunkSection = {
        Y: section.Y,
        biomes: {
          palette: []
        }
      };
      if (section.Palette) {
        newSection.block_states = {
          palette: section.Palette,
          data: section.BlockStates!
        };
      }
      sections.push(newSection);
    }
    return {
      DataVersion: levelChunk.DataVersion,
      Heightmaps: {
        WORLD_SURFACE:
          levelChunk.Level.Heightmaps?.WORLD_SURFACE ||
          levelChunk.Level.HeightMap
      },
      InhabitedTime: levelChunk.Level.InhabitedTime,
      LastUpdate: levelChunk.Level.LastUpdate,
      Status: levelChunk.Level.Status,
      xPos: levelChunk.Level.xPos,
      yPos: 0,
      zPos: levelChunk.Level.zPos,
      sections: sections,
      yMin: 0
    };
  }

  /**
   * Given a chunk's data, returns a list of map color ids and y levels for each block in the chunk.
   * The list contains 256 entries (16x16).
   */
  getChunkMapData(
    chunk: Chunk,
    mapPalette: MapPalette,
    maxYLevel: number
  ): ChunkMapData | null {
    if (!chunk.Heightmaps?.WORLD_SURFACE) {
      return null;
    }

    /**
     * Versions prior to 1.16 stored heightmap data and block data in continuous streams of bits
     * instead of having extra bits of padding at the end of every entry. For heightmaps, this
     * resulted in a length of 36 (9 bits per entry * 256 entries / 64 bit bigints) instead of 37.
     */
    if (
      chunk.Heightmaps.WORLD_SURFACE.length ===
      AnvilService.PADDED_HEIGHTMAP_LENGTH
    ) {
      return this.getPaddedChunkMapData(chunk, mapPalette, maxYLevel);
    } else {
      return this.getContinuousChunkMapData(chunk, mapPalette, maxYLevel);
    }
  }

  /**
   * Get the chunk's map data given the data is stored in the padded format.
   */
  private getPaddedChunkMapData(
    chunk: Chunk,
    mapPalette: MapPalette,
    maxYLevel: number
  ): ChunkMapData {
    const colorIds: number[] = [];
    const yLevels: number[] = [];
    let blockIndex = 0;
    for (const heightMapEntry of chunk.Heightmaps!.WORLD_SURFACE!) {
      for (let i = 0; i < 7 && blockIndex < 256; ++i, ++blockIndex) {
        const yLevel = Math.min(
          Number(
            (heightMapEntry >>
              BigInt(i * AnvilService.BIT_IN_HEIGHTMAP_ENTRY)) &
              0x1ffn
          ) +
            (chunk.yMin - 1),
          maxYLevel
        );
        const blockMapData = this.getBlockMapData(
          chunk,
          blockIndex,
          yLevel,
          mapPalette,
          false
        );
        colorIds.push(blockMapData.colorId);
        yLevels.push(blockMapData.yLevel);
      }
    }
    return {
      colorIds: colorIds,
      yLevels: yLevels
    };
  }

  /**
   * Get the chunk's map data given the data is stored in the continuous format.
   */
  private getContinuousChunkMapData(
    chunk: Chunk,
    mapPalette: MapPalette,
    maxYLevel: number
  ): ChunkMapData {
    const colorIds: number[] = [];
    const yLevels: number[] = [];
    for (let blockIndex = 0; blockIndex < 256; ++blockIndex) {
      const heightMapValue = this.getValueFromContinuousData(
        chunk.Heightmaps!.WORLD_SURFACE!,
        blockIndex,
        AnvilService.BIT_IN_HEIGHTMAP_ENTRY
      );

      const yLevel = Math.min(heightMapValue + (chunk.yMin - 1), maxYLevel);
      const blockMapData = this.getBlockMapData(
        chunk,
        blockIndex,
        yLevel,
        mapPalette,
        true
      );
      colorIds.push(blockMapData.colorId);
      yLevels.push(blockMapData.yLevel);
    }
    return {
      colorIds: colorIds,
      yLevels: yLevels
    };
  }

  /**
   * Get the map data for a specific block in a chunk.
   */
  private getBlockMapData(
    chunk: Chunk,
    blockIndex: number,
    startingYLevel: number,
    mapPalette: MapPalette,
    continuousData: boolean
  ): { colorId: number; yLevel: number } {
    let colorId: MapIds = MapIds.NONE;
    let isWater = false;
    for (
      ;
      colorId === MapIds.NONE && startingYLevel >= chunk.yMin;
      --startingYLevel
    ) {
      const paletteEntry = this.getChunkPaletteEntry(
        chunk.sections,
        blockIndex,
        startingYLevel,
        chunk.yMin,
        continuousData
      );
      if (!paletteEntry) continue;

      colorId = this.getMapColorId(paletteEntry, mapPalette);
      if (colorId === MapIds.WATER) {
        colorId = MapIds.NONE;
        isWater = true;
      }
    }
    return {
      colorId: isWater ? MapIds.WATER : colorId,
      yLevel: startingYLevel
    };
  }

  /**
   * Given a paletteEntry, returns the map color id associated with this block.
   */
  private getMapColorId(
    paletteEntry: BlockPaletteEntry,
    mapPalette: MapPalette
  ): MapIds {
    const blockPaletteEntryId = (
      typeof paletteEntry === "object"
        ? (paletteEntry[""] ?? paletteEntry.id ?? paletteEntry.Name)!
        : paletteEntry
    ).slice(10);
    let blockColor = mapPalette[blockPaletteEntryId];
    if (blockColor === undefined && mapPalette !== originalMapPalette) {
      blockColor = originalMapPalette[blockPaletteEntryId];
    }
    if (!blockColor) return MapIds.NONE;
    if (typeof blockColor === "number") return blockColor;
    if (typeof paletteEntry === "string" || paletteEntry[""] !== undefined) {
      return blockColor[0]?.id ?? MapIds.NONE;
    }
    for (const color of blockColor) {
      let match = true;
      for (const property in color.properties) {
        if (
          color.properties[property] !==
          (paletteEntry.properties ?? paletteEntry.Properties)?.[property]
        ) {
          match = false;
          break;
        }
      }
      if (match) return color.id;
    }
    return MapIds.NONE;
  }

  /**
   * Returns the name of a Minecraft block in a chunk given the chunk's section, the block's index (x,z) in the chunk, and its y level.
   * Each chunk section consists of a palette of Minecraft blocks and a list of bigints that contain palette indices.
   * The number of palette indices per BigInt depends on the size of the palette (how many bits are needed to store a palette index).
   * Like height maps, blocks are stored in this increasing order: XZY.
   */
  private getChunkPaletteEntry(
    chunkSections: ChunkSection[],
    chunkBlockIndex: number,
    blockYLevel: number,
    minYLevel: number,
    continuousData: boolean
  ): BlockPaletteEntry | undefined {
    /**
     * Sections in a chunk are split based on y level.
     * 16 block height per section. Usually, the index
     * corresponds with the yLevel. If not, search for
     * the correct yLevel if it exists.
     */
    const yLevel = Math.floor(blockYLevel / 16);
    const sectionIndex = Math.floor((blockYLevel - minYLevel) / 16);
    let section: ChunkSection | undefined = chunkSections[sectionIndex];
    if (section?.Y !== yLevel) {
      if (!section) {
        section = chunkSections.find((section) => section.Y === yLevel);
      } else if (section.Y < yLevel) {
        for (let i = sectionIndex + 1; i < chunkSections.length; ++i) {
          if (chunkSections[i].Y === yLevel) {
            section = chunkSections[i];
            break;
          }
        }
      } else {
        for (let i = sectionIndex - 1; i >= 0; --i) {
          if (chunkSections[i].Y === yLevel) {
            section = chunkSections[i];
            break;
          }
        }
      }
    }

    if (!section?.block_states) {
      return undefined;
    }

    /**
     * If a section only contains 1 type of block.
     */
    if (section.block_states.palette.length === 1) {
      return section.block_states.palette[0];
    }

    /**
     * Each data entry consists of a palette index.
     * What is the minimum number of bits required to store a palette index (depends on size of palette).
     * Minimum of 4 bits required.
     */
    const entrySizeBits = Math.max(
      Math.ceil(Math.log2(section.block_states.palette.length)),
      4
    );

    /**
     * What is the index of the entry we are looking for?
     * (How many entries are before the one we are looking for?)
     * Use the relative y level of our block in the section.
     * Each y level consists of 256 entries.
     */
    const sectionYLevel = blockYLevel % 16;
    const entryIndex =
      (sectionYLevel >= 0 ? sectionYLevel : sectionYLevel + 16) * 256 +
      chunkBlockIndex;

    let paletteIndex: number;
    if (continuousData) {
      paletteIndex = this.getValueFromContinuousData(
        section.block_states.data,
        entryIndex,
        entrySizeBits
      );
    } else {
      const entriesPerBlockStateEntry = Math.floor(64 / entrySizeBits);
      const blockStateIndex = Math.floor(
        entryIndex / entriesPerBlockStateEntry
      );
      paletteIndex = Number(
        (section.block_states.data[blockStateIndex] >>
          BigInt((entryIndex % entriesPerBlockStateEntry) * entrySizeBits)) &
          BigInt(Math.pow(2, entrySizeBits) - 1)
      );
    }
    return section.block_states.palette[paletteIndex];
  }

  /**
   * Get a value from a continuous data array (the value we seek could stretch across two indices of the array).
   */
  private getValueFromContinuousData(
    data: bigint[],
    entryIndex: number,
    entrySizeBits: number,
    dataEntrySizeBits: number = 64
  ): number {
    const bitIndex = entryIndex * entrySizeBits;
    const bitsUsedFirstEntry = bitIndex % dataEntrySizeBits;
    const bitsFreeFirstEntry = dataEntrySizeBits - bitsUsedFirstEntry;
    const dataEntryIndex = Math.floor(bitIndex / dataEntrySizeBits);

    let dataValue: number;
    if (bitsFreeFirstEntry >= entrySizeBits) {
      dataValue = Number(
        (data[dataEntryIndex] >> BigInt(bitsUsedFirstEntry)) &
          BigInt(Math.pow(2, entrySizeBits) - 1)
      );
    } else {
      const dataValue1 = Number(
        (data[dataEntryIndex] >> BigInt(bitsUsedFirstEntry)) &
          BigInt(Math.pow(2, bitsFreeFirstEntry) - 1)
      );
      const dataValue2 = Number(
        (data[dataEntryIndex + 1] &
          BigInt(Math.pow(2, entrySizeBits - bitsFreeFirstEntry) - 1)) <<
          BigInt(bitsFreeFirstEntry)
      );
      dataValue = Number(dataValue1 | dataValue2);
    }
    return dataValue;
  }
}
