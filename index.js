import "dotenv/config";
import Postgres from "./classes/postgres.js";
import TwitchBot from "./classes/twitchbot.js";
import TokenGenerator from "./classes/tokengenerator.js";

const postgres = new Postgres(
  "postgres",
  process.env.DB_HOST,
  "twitch_bot",
  process.env.DB_PASS,
  5432,
);

const ENV = await postgres.fetchEnvironmentVariables();

const BOT_USER_ID = "960074192";
const CHANNEL_USER_ID = "61362118";

const twitchBot = new TwitchBot(
  ENV.AUTH_TOKEN,
  ENV.REFRESH_TOKEN,
  ENV.CLIENT_ID,
  ENV.CLIENT_SECRET,
  BOT_USER_ID,
  CHANNEL_USER_ID,
);

async function start() {
  try {
    await twitchBot.validateToken();
    twitchBot.initializeWebsocket();
    return;
  } catch (err) {
    if (err.message !== "Invalid Access Token") {
      console.error("Unexpected error:", err);
      process.exit();
    }
  }

  try {
    await revalidateAndRestart();
  } catch (err) {
    console.error("Revalidation failed");
    await handleRevalidationFailure();
  }
}

async function revalidateAndRestart() {
  await twitchBot.revalidateToken();
  await postgres.updateTokens(twitchBot.authToken, twitchBot.refreshToken);
  await start();
}

async function handleRevalidationFailure() {
  console.log("Attempting full token retrieval.");
  const tokenGenerator = new TokenGenerator(
    ENV.CLIENT_ID,
    ENV.CLIENT_SECRET,
    ENV.REDIRECT_URL,
    ENV.SCOPES,
    ENV.STATE,
  );

  tokenGenerator.setupRoutes();
  const NEW_TOKENS = await tokenGenerator.retrieveTokens();
  twitchBot.authToken = NEW_TOKENS.authToken;
  twitchBot.refreshToken = NEW_TOKENS.refreshToken;

  await postgres.updateTokens(NEW_TOKENS.authToken, NEW_TOKENS.refreshToken);

  console.log("Restarting bot.");
  await start();
}

start();
