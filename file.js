const fs = require("fs");



const readLines = (path) => {
  return fs.readFileSync(path, "utf-8").split("\n");
};

const parseUser = (line) => {
  if (!line.includes("c_user")) return null;
  const object = {};
  line = line.split("|");
  object.user_id = line[0];
  object.password = line[1];
  for (const value of line) {
    if (value.includes("c_user")) {
      object.cookie = value;
    }
  }
  return object;
};

const readUsers = (path) => {
  return readLines(path)
    .map((line) => parseUser(line))
    .filter((user) => user);
};

module.exports = { readLines, parseUser, readUsers };
