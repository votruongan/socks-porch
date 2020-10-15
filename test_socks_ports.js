const request = require('request-promise')
const SocksProxyAgent = require('socks-proxy-agent')

const socksPrefix = "socks://139.180.133.158:";
const startPort = 9090;
const portCount = 20;
const requestCount = 20;

let errCount = 0;
const sucCount = Array.apply(null, Array(portCount)).map(function () {
    return 0;
  });

function resolved(p){
    sucCount[p - startPort]++;
    // console.log("succeed",length,"fail count:",errCount,"total return:", (++sucCount) + errCount);
}

const test = (port) => {
  const agent = new SocksProxyAgent(socksPrefix + port);
  return request("https://m.facebook.com", {
    agent,
    headers:{
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.87 Safari/537.36"
    }
  },(e,r,b)=>{
    if (e) return ;//console.log("ERR:",port,"fail count:",++errCount);
    resolved(port)
  }).catch((e)=>{});//console.log("port",port," rejected")});
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
    
async function main() {
  for (let i = 0; i < portCount; i++) {
    const port = startPort + i
    console.log("create request port",port);
    for (let i = 0; i < requestCount; i++) {
        try {
            test(port)
            // console.log("called", port)
        }catch (err) {
            console.log("Err", port)
        }
    }
    await sleep(3000);
  }
  await sleep(30000);
  for (let i = 0; i < sucCount.length; i++) {
      const ele = sucCount[i];
      if (ele < requestCount){
          console.log(">>> port",startPort+i," succeed:",ele,"/",requestCount);
      }
  }
}


main()