import { SNBT, SNBTValue } from "../../../models/snbt";

interface Changelog extends SNBT {
  Changelog: { [key: string]: ReleaseVersion };
}

interface ReleaseVersion extends SNBT {
  releaseDate: string;
  features?: SNBTValue;
  bugFixes?: SNBTValue;
}

/**
 * The Changelog is for updates relevant to the user, not the code.
 */
export const ChangeLogData: Changelog = {
  Changelog: {
    "1.9.0": {
      releaseDate: "September 12, 2026",
      features: [
        "Added support for upcoming Minecraft version 26.3.",
        "Removed more blocks from the 'Blocks Only' map type (glass, carpet, trapdoors, pressure plates, grates, workstations)."
      ]
    },
    "1.8.0": {
      releaseDate: "June 1, 2026",
      features: ["Added support for upcoming Minecraft version 26.2."]
    },
    "1.7.0": {
      releaseDate: "March 16, 2026",
      features: [
        "A note that all dates are in UTC time was added in the advancements page settings."
      ]
    },
    "1.6.0": {
      releaseDate: "March 2, 2026",
      features: [
        "The player's username now shows alongside the file name in the player data page."
      ]
    },
    "1.5.0": {
      releaseDate: "March 1, 2026",
      features: [
        "The maps page url has been changed from '/map' to '/maps'.",
        "Available settings values that differ by world (player selections, world data files) are now stored and restored when navigating " +
          "back and forth between tabs. Previously, these settings were simply reset.",
        "Map coordinates and zoom level are now stored and restored when navigating away from and back to the maps page.",
        "The starting map coordinates settings from the maps page have been removed."
      ],
      bugFixes: [
        "Fixed advancements category settings not storing correctly.",
        "Replaced double quotes inside the changelog with single quotes."
      ]
    },
    "1.4.0": {
      releaseDate: "February 28, 2026",
      features: [
        "Added support for upcoming Minecraft version 26.1.",
        "Changed the 'World Info' page to 'World Data'",
        "The 'World Data' page settings allow the selection of any 'dat' file other than maps."
      ]
    },
    "1.3.2": {
      releaseDate: "February 22, 2026",
      bugFixes: [
        "Fixed maps not displaying correctly for Minecraft version 1.19."
      ]
    },
    "1.3.1": {
      releaseDate: "February 19, 2026",
      bugFixes: [
        "Adjusted the changelog language and data to be simpler and more readable."
      ]
    },
    "1.3.0": {
      releaseDate: "February 16, 2026",
      features: ["Added a changelog accessible through the help popup."]
    },
    "1.2.1": {
      releaseDate: "February 14, 2026",
      bugFixes: [
        "Fixed spaces appearing in grid column headers due to a default AG Grid setting."
      ]
    },
    "1.2.0": {
      releaseDate: "February 12, 2026",
      features: [
        "Added a zoom feature to the map that is controlled by scrolling over the map.",
        "Increased the maximum map length in chunks from 25 to 64.",
        "Replaced the 'Nothing to See Here' disclaimer with a title and a description for each page.",
        "Upgraded map performance by using a least-recently-used cache to store chunk images and an asynchronous queue to fetch chunk images."
      ],
      bugFixes: [
        "Fixed the maximum length of the map in chunks not being applied correctly in certain scenarios."
      ]
    },
    "1.1.0": {
      releaseDate: "January 27, 2026",
      features: [
        "The map now loads chunks while dragging. It no longer waits for dragging to end to load the chunks of the viewable area."
      ],
      bugFixes: [
        "Map chunks load much faster after fixing a bug causing a miscalculation of the y level from a height map."
      ]
    },
    "1.0.0": {
      releaseDate: "January 25, 2026",
      features: [
        "Upload Minecraft save folders and inspect various files and their data.",
        "View general world information on the World Info page.",
        "Interact with draggable world maps of all three Minecraft dimensions on the Map page.",
        "View general player information on the Player Data page.",
        "Compare players' statistics on the Stats page.",
        "Compare players' advancements on the Advancements page.",
        "All page settings are cached in the browser and used to repopulate settings on refresh.",
        "A light and dark mode."
      ]
    }
  }
};
