const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length > 5;
};

//register

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);

  if (databaseUser === undefined) {
    const createUserQuery = `
     INSERT INTO
      user (name, username, password, gender)
     VALUES
      (
       '${name}',
       '${username}',
       '${hashedPassword}',
       '${gender}'  
      );`;
    if (validatePassword(password)) {
      await database.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//login code

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUser = `
    SELECT *
    FROM user
    WHERE username='${username}';
    `;
  const dbUser = await database.get(selectUser);
  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//middle ware

const authenticateToken = (request, response, next) => {
  let jwtToken = null;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
};

const convertObjectProperties = (item) => {
  return {
    username: item.username,
    tweet: item.tweet,
    dateTime: item.date_time,
  };
};

const getTweetObject = (item) => ({
  tweet: item.tweet,
  likes: item.likes,
  replies: item.replies,
  dateTime: item.date_time,
});

//API 3

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweetsQuery = `
    SELECT user.username,tweet.tweet,tweet.date_time 
    FROM user INNER JOIN follower ON user.user_id=follower.following_user_id INNER JOIN
    tweet ON follower.following_user_id=tweet.user_id
    GROUP BY follower.following_user_id
    ORDER BY tweet.date_time DESC
    LIMIT 4;
    `;
  let databaseResult = await database.all(latestTweetsQuery);
  response.send(
    databaseResult.map((eachItem) => convertObjectProperties(eachItem))
  );
});

//API 4

app.get("/user/following/", authenticateToken, async (request, response) => {
  const followingUserQuery = `
    SELECT user.name
    FROM user INNER JOIN follower ON user.user_id=follower.following_user_id
    GROUP BY follower.following_user_id
    ORDER BY follower.following_user_id ASC;
    `;
  const getFollowingUsers = await database.all(followingUserQuery);
  response.send(getFollowingUsers);
});

//API 5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followersUserQuery = `
    SELECT user.name
    FROM user INNER JOIN follower ON user.user_id=follower.follower_user_id
    GROUP BY follower.follower_user_id;
    `;
  const getFollowers = await database.all(followersUserQuery);
  response.send(getFollowers);
});

//API 6

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const findFollowUserQuery = `
  SELECT *
  FROM user INNER JOIN follower ON user.user_id=follower.following_user_id 
  INNER JOIN tweet ON follower.following_user_id=tweet.user_id
  ;

  `;
  const exitFollowingUser = await database.get(findFollowUserQuery);

  if (exitFollowingUser !== undefined) {
    const getTweetQuery = `
    SELECT tweet.tweet,COUNT(like.tweet_id) AS likes,COUNT(reply.tweet_id) AS replies,tweet.date_time
    FROM tweet INNER JOIN like ON tweet.tweet_id=like.tweet_id INNER JOIN reply
    ON tweet.tweet_id=reply.tweet_id
    WHERE tweet.tweet_id='${tweetId}';
    `;
    const getTweet = await database.get(getTweetQuery);
    response.send(getTweetObject(getTweet));
  } else {
    response.send(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
