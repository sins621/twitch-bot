import TwitchBot from "./twitch_bot.js";
import Requests from "./requests.js";

const requests = new Requests();

const commands = {
  "!today":
    "Refactoring Twitch-bot Code and Potentially adding Spotify Support",
  "!song": await requests.now_playing(),
};

const twitchBot = new TwitchBot(commands);

twitchBot.run();
