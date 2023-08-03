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

//register code

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

function authenticateToken(request, response, next) {
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
}

const tweetsResponse = (item) => {
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

//user tweets api

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweetsQuery = await database.all(`
    SELECT 
    tweet.tweet_id,
    tweet.user_id,
    user.username,
    tweet.tweet,
    tweet.date_time
    FROM follower LEFT JOIN tweet ON tweet.user_id=follower.following_user_id 
    LEFT JOIN user ON follower.following_user_id=user.user_id
    WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${request.username}' )
    ORDER BY tweet.date_time DESC
    LIMIT 4;
    `);

  response.send(latestTweetsQuery.map((eachItem) => tweetsResponse(eachItem)));
});

//following users

app.get("/user/following/", authenticateToken, async (request, response) => {
  const followingUserQuery = `
    SELECT user.name
    FROM follower LEFT JOIN user ON follower.following_user_id=user.user_id
    WHERE follower.follower_user_id=(SELECT user_id  FROM user WHERE username='${request.username}')
    `;
  const getFollowingUsers = await database.all(followingUserQuery);
  response.send(getFollowingUsers);
});

//followers users

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followersUserQuery = `
    SELECT user.name
    FROM follower LEFT JOIN user ON follower.follower_user_id=user.user_id
    WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username='${request.username}' );
    `;
  const getFollowers = await database.all(followersUserQuery);
  response.send(getFollowers);
});

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  const followingQuery = `
    SELECT * FROM follower
    WHERE follower_user_id=(SELECT user_id FROM user WHERE username='${request.username}') AND
    following_user_id=(SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id='${tweetId}');
    `;
  let isFollowing = await database.get(followingQuery);

  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//get specific tweet api 6

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await database.get(
      `SELECT tweet,date_time FROM tweet WHERE tweet_id='${tweetId}';`
    );
    const { likes } = await database.get(
      `SELECT COUNT (like_id) as likes FROM like WHERE tweet_id='${tweetId}';`
    );
    const { replies } = await database.get(
      `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id='${tweetId}';`
    );
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//api 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedQuery = await database.all(
      `SELECT user.username FROM like NATURAL JOIN user WHERE tweet_id = '${tweetId}';`
    );
    response.send({ likes: likedQuery.map((item) => item.username) });
  }
);

//api 8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await database.all(`
    SELECT user.name, reply.reply FROM reply NATURAL JOIN user WHERE tweet_id='${tweetId}';
    `);
    response.send({ replies });
  }
);
//api 9

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const myTweets = await database.all(`
    SELECT tweet.tweet, COUNT(distinct like.like_id) AS likes,
    COUNT (distinct reply.reply_id) AS replies,
    tweet.date_time
    FROM tweet LEFT JOIN like ON tweet.tweet_id=like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id
    WHERE tweet.user_id = (SELECT  user_id FROM user WHERE username='${request.username}')
    GROUP BY tweet.tweet_id;

    `);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

//api 10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await database.get(
    `SELECT user_id FROM user WHERE username='${request.username}'`
  );
  await database.run(`
    INSERT INTO tweet (tweet,user_id)
    VALUES ('${tweet}','${user_id}');
    `);

  response.send("Created a Tweet");
});

//api 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await database.get(`
    SELECT tweet_id,user_id
    FROM tweet
    WHERE tweet_id='${tweetId}' and user_id=(SELECT user_id FROM user WHERE username='${request.username}');
    `);
    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await database.run(`
        DELETE FROM tweet
        WHERE tweet_id='${tweetId}';
        `);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
