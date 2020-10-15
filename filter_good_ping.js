const _ = require("lodash");
const ping = require('ping');
const { readLines } = require("./file");
const Queue = require("./queue");
const fs = require("fs")


const GOOD_TIMEOUT = 1; //seconds

const fileName = process.argv[2] || "./VN.txt";


const connectionList = readLines(fileName).map((val) => { return val.split("|") });

const q = new Queue({
    input: connectionList,
    concurrency: 200,
    onValue: async (value, index) => {
        console.log('Index', index, value[0]);
        let res = await ping.promise.probe(value[0], {
                timeout: GOOD_TIMEOUT,
        });
        if (res.alive == true){
            fs.appendFileSync('./good_ping.txt', value.join('|') + '\n');
        }
    },
});

q.start();
  