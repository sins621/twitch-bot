import express from "express";
import axios from "axios";
import fs from "node:fs/promises";
import morgan from "morgan";
import "dotenv/config";
import WebSocket from "ws";

// TODO: Error Handling
// TODO: Validate Token on Startup and Refresh if Necessary
// TODO: Deployment

const APP = express();
const PORT = 7817;
const ENDPOINT = "/api/twitch";
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URL = process.env.TWITCH_REDIRECT_URL;
const STATE = process.env.STATE;
const SCOPES = "channel:bot user:bot user:read:chat user:write:chat";
const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
const BOT_USER_ID = "960074192";
const CHAT_CHANNEL_USER_ID = "61362118";
const SPOTIFY_ENDPOINT = "https://www.sins621.com/api/spotify";

try {
  const TOKENS = JSON.parse(
    await fs.readFile("tokens.json", { encoding: "utf8" }),
  );
  var AUTH_TOKEN = TOKENS.auth_token;
  var REFRESH_TOKEN = TOKENS.refresh_token;
} catch (err) {
  if (err.code !== "ENOENT") {
    throw err;
  } else {
    var AUTH_TOKEN = null;
    var REFRESH_TOKEN = null;
  }
}

function encode_params(params) {
  let ENCODED_STRING = "";
  let i = 0;
  Object.entries(params).forEach(([key, value]) => {
    if (i === Object.keys(params).length - 1) {
      ENCODED_STRING += `${key}=${encodeURIComponent(value)}`;
    } else {
      ENCODED_STRING += `${key}=${encodeURIComponent(value)}&`;
    }
    i++;
  });

  return ENCODED_STRING;
}

APP.use(morgan("tiny"));

APP.get(`${ENDPOINT}/authenticate`, async (_req, res) => {
  const TWITCH_CODE_ENDPOINT = "https://id.twitch.tv/oauth2/authorize";
  const PARAMS = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URL,
    scope: SCOPES,
    state: STATE,
  };

  const URL = `${TWITCH_CODE_ENDPOINT}?${encode_params(PARAMS)}`;
  return res.redirect(URL);
});

APP.get(`${ENDPOINT}/auth_redirect`, async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const CODE = req.query.code;
  const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
  const PARAMS = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: CODE,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URL,
  };

  try {
    const RESULT = await axios.post(TWITCH_TOKEN_ENDPOINT, PARAMS);
    const DATA = RESULT.data;

    if (!DATA.hasOwnProperty("access_token")) {
      return res
        .end(JSON.stringify({ error: `Error Fetching Auth Token` }))
        .status(401);
    }

    AUTH_TOKEN = DATA.access_token;

    if (DATA.hasOwnProperty("refresh_token")) {
      REFRESH_TOKEN = DATA.refresh_token;
    }

    const TOKENS = JSON.stringify({
      auth_token: AUTH_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });

    await fs.writeFile("tokens.json", TOKENS, { encoding: "utf8" });
  } catch (err) {
    return res
      .end(JSON.stringify({ error: `Server Error: ${err}` }))
      .status(503);
  }
  return res
    .end(JSON.stringify({ message: `Successfully Authenticated Twitch` }))
    .status(200);
});

APP.get(`${ENDPOINT}/start`, async (_req, res) => {
  try {
    websocket_client();
    return res.send("Started Bot").status(200);
  } catch (err) {
    return res.send("Server Error").status(500);
  }
});

async function websocket_client() {
  let websocket_client = new WebSocket(EVENTSUB_WEBSOCKET_URL);
  websocket_client.on("error", console.error);
  websocket_client.on("open", () => {
    console.log("WebSocket connection opened to " + EVENTSUB_WEBSOCKET_URL);
  });

  websocket_client.on("message", async (data) => {
    let socket_data = JSON.parse(data.toString());
    let message_type = socket_data.metadata.message_type;

    if (message_type === "session_welcome") {
      const WEBSOCKET_SESSION_ID = socket_data.payload.session.id;
      register_event_sub_listeners(WEBSOCKET_SESSION_ID);
    }

    if (message_type === "notification") {
      var subscription_type = socket_data.metadata.subscription_type;
    }

    // TODO: Refactor this into something with less nesting somehow
    if (subscription_type === "channel.chat.message") {
      var sender = socket_data.payload.event.chatter_user_login;
      var chat_message = socket_data.payload.event.message.text.trim();
      console.log(`${sender}: ${chat_message}`);
      if (Array.from(chat_message)[0] === "!") {
        var chat_command = chat_message.match(/^\s*(\S+)\s*(.*?)\s*$/).slice(1);
        if (Array.from(chat_command[1]).length === 0) {
          exec_command(chat_command[0]);
        } else {
          exec_command_with_query(chat_command[0], chat_command[1]);
        }
      }
    }
  });
  return websocket_client;
}

async function exec_command(command) {
  switch (command) {
    case "!song":
      try {
        const REQUEST = await axios.get(`${SPOTIFY_ENDPOINT}/playing`);
        if (REQUEST.status === 204) {
          send_chat_message("No song is currently playing");
          break;
        }
        const DATA = REQUEST.data;
        const SONG_NAME = DATA.song_name;
        const ARTISTS = DATA.artists.toString().replace(/,/g, ", ");
        send_chat_message(`Now playing ${SONG_NAME} by ${ARTISTS}.`);
      } catch (err) {
        console.log(err);
      }
      break;

    case "!queue":
      try {
        const REQUEST = await axios.get(`${SPOTIFY_ENDPOINT}/queue`);
        if (REQUEST.status === 204 || REQUEST.data.length === 0) {
          send_chat_message("No songs are currently playing");
          break;
        }
        const DATA = REQUEST.data;
        let message = "";
        for (let i = 0; i < DATA.length; ++i) {
          const SONG_NAME = DATA[i].song_name;
          const ARTISTS = DATA[i].artists.toString().replace(/,/g, ", ");
          message += `${i + 1}. ${SONG_NAME} by ${ARTISTS}`;
          if (i < DATA.length - 1) {
            message += ", ";
          } else {
            message += ".";
          }
        }
        send_chat_message(message);
      } catch (err) {
        console.log(err);
      }
      break;

    case "!skip":
      try {
        await axios.get(`${SPOTIFY_ENDPOINT}/skip`);
        send_chat_message("Song Skipped");
      } catch (err) {}
  }
}

async function exec_command_with_query(command, query) {
  switch (command) {
    case "!songrequest":
      try {
        const REQUEST = await fetch(
          `${SPOTIFY_ENDPOINT}/search?` +
            new URLSearchParams({
              q: query,
            }).toString(),
        );
        const DATA = await REQUEST.json();
        const SONG_NAME = DATA.song_name;
        const ARTISTS = DATA.artists.toString().replace(/,/g, ", ");
        send_chat_message(`Added ${SONG_NAME} by ${ARTISTS} to the queue.`);
      } catch (err) {
        console.log(err);
      }
      break;
  }
}

async function register_event_sub_listeners(WEBSOCKET_SESSION_ID) {
  console.log("Registering Event Sub Listeners");
  const HEADERS = {
    Authorization: "Bearer " + AUTH_TOKEN,
    "Client-Id": CLIENT_ID,
    "Content-Type": "application/json",
  };
  const BODY = {
    type: "channel.chat.message",
    version: "1",
    condition: {
      broadcaster_user_id: CHAT_CHANNEL_USER_ID,
      user_id: BOT_USER_ID,
    },
    transport: {
      method: "websocket",
      session_id: WEBSOCKET_SESSION_ID,
    },
  };

  let response = await axios.post(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    BODY,
    { headers: HEADERS },
  );

  if (response.status === 401) {
    const TWITCH_REFRESH_ENDPOINT = "https://id.twitch.tv/oauth2/token";
    const PARAMS = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    };

    try {
      const RESULT = await axios.post(TWITCH_REFRESH_ENDPOINT, PARAMS);
      const DATA = RESULT.data;

      if (!DATA.hasOwnProperty("access_token")) {
        return res
          .end(JSON.stringify({ error: `Error Fetching Auth Token` }))
          .status(401);
      }

      AUTH_TOKEN = DATA.access_token;

      if (DATA.hasOwnProperty("refresh_token")) {
        REFRESH_TOKEN = DATA.refresh_token;
      }

      const TOKENS = JSON.stringify({
        auth_token: AUTH_TOKEN,
        refresh_token: REFRESH_TOKEN,
      });

      await fs.writeFile("tokens.json", TOKENS, { encoding: "utf8" });
      setTimeout(() => {
        websocket_client();
      }, 1000 * 10);
    } catch (err) {
      return res
        .end(JSON.stringify({ error: `Server Error: ${err}` }))
        .status(503);
    }
  } else if (response.status != 202) {
    console.error(
      "Failed to subscribe to channel.chat.message. API call returned status code " +
        response.status,
    );
  } else {
    console.log(`Subscribed to channel.chat.message`);
  }
}

async function send_chat_message(chat_message) {
  const HEADERS = {
    Authorization: "Bearer " + AUTH_TOKEN,
    "Client-Id": CLIENT_ID,
    "Content-Type": "application/json",
  };
  const BODY = {
    broadcaster_id: CHAT_CHANNEL_USER_ID,
    sender_id: BOT_USER_ID,
    message: chat_message,
  };

  let response = await axios.post(
    "https://api.twitch.tv/helix/chat/messages",
    BODY,
    { headers: HEADERS },
  );

  if (response.status != 200) {
    let data = await response.json();
    console.error("Failed to send chat message");
    console.error(data);
  } else {
    console.log("Sent chat message: " + chat_message);
  }
}

try {
  websocket_client();
} catch (err) {
  console.log("Error Starting Twitch Bot");
}

APP.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);
});

// NOTE: maybe use later???

//let response = await fetch("https://id.twitch.tv/oauth2/validate", {
//  method: "GET",
//  headers: {
//    Authorization: "OAuth " + AUTH_TOKEN,
//  },
//});
//
//if (response.status != 200) {
//  throw new Error(
//    "Token is not valid. /oauth2/validate returned status code " +
//      response.status,
//  );
//}
//
//console.log(response);
//console.log("Validated token.");
