const request = require("request");
const gzip = require("node-gzip");
const { readLines } = require("./file");

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36";

const newProxy = (options) => {
  options = options || {};
  const residential = options.residential;
  if (residential) {
    return "http://huonglan:AogOpMQtGPYiuJl7_country-Taiwan@proxy3.drycom.xyz:31112";
  }

  const session = options.session;
  const country = options.country;
  return `http://lum-customer-vo_minh_hieu-zone-static-country-${country}-session-${session}:fs4md0octxol@209.97.164.10:22225`;
};

const getAccessToken = async () => {
  const tokenList = readLines("data/access_token");
  for (const token of tokenList) {
    try {
      await request("https://graph.facebook.com/me?access_token=" + token);
      return token;
    } catch (error) {}
  }
};

const getPage = (options) => {
  options = options || {};
  const proxy = options.proxy;
  console.log(proxy);
  const cookie = options.cookie;
  const agent = options.agent;
  const url = options.url;
  return new Promise((resolve, reject) => {
    const headers = newHeaders({ cookie });

    request(
      {
        proxy,
        agent,
        url: url || "https://mbasic.facebook.com/",
        method: "GET",
        headers: headers,
      },
      async (error, response, body) => {
        // console.log(">>>", response.headers["set-cookie"]);
        // body = (await gzip.ungzip(body)).toString();
        if (error) return reject(error);
        if (!response.headers["set-cookie"]) {
          return resolve({
            body,
            location: response.headers.location,
          });
        }

        const cookie = response.headers["set-cookie"].join(";");
        resolve({
          body,
          cookie,
          location: response.headers.location,
        });
      }
    );
  });
};

const newHeaders = (options) => {
  return Object.assign(
    {
      "sec-fetch-user": "?1",
      "user-agent": userAgent
    },
    options
  );
};

module.exports = { getPage, newHeaders, newProxy, getAccessToken };
