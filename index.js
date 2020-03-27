const express = require("express");
const cors = require('cors');
const fs = require("fs");
var app = express();
var bodyParser = require('body-parser');

var private = require('./private');


app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('polymorph'));
app.listen(8080);

app.use(cors());


app.post("/saveme", (req, res) => {
    let safeF = String(req.query.f).replace(/\./g, "_");
    try {
        fs.mkdirSync(private.baseLogLocation + "/" + safeF);
    } catch (e) {
        //directory exists, ignore
    }
    let file = private.baseLogLocation + `/${safeF}/${safeF}_${Date.now()}.json`;
    fs.writeFile(file, JSON.stringify(req.body), (e) => {
        console.log(e || file);
        res.sendStatus(200);
        res.end();
    });
});

let path = require("path");
app.get("/loadme", (req, res) => {
    let saveF = String(req.query.f).replace(/\./g, "_");
    fs.readdir(private.baseLogLocation + "/" + saveF, (err, files) => {
        if (err || files.length == 0) {
            res.send("");
            res.end();
            console.log(err);
        } else {
            latestTime = 0;
            files.forEach(i => {
                console.log(i);
                let lastTimeRe = /.+?(\d+)\.json/.exec(i);
                if (lastTimeRe) {
                    let lastTime = Number(lastTimeRe[1]);
                    if (lastTime > latestTime) {
                        latestTime = lastTime;
                    }
                }
            });
            if (latestTime != 0) {
                fs.readFile(path.join(private.baseLogLocation + "/" + saveF, saveF + "_" + latestTime + ".json"), (err, data) => {
                    if (err) {
                        res.send("");
                        console.log(err);
                    }
                    else {
                        res.send(String(data));
                        console.log(latestTime);
                    }
                    res.end();
                });
            } else {
                res.send("");
                res.end();
            }
        }
    })
});


// create a websocket server that listens for changes and pushes them over nanogram; and vice versa


let WebSocketServer = require('websocket').server;
let nanogram = require('./nanogram');
let http = require('http');
let wshtserver = http.createServer(function (request, response) {
});
wshtserver.listen(14403, function () { });

// create the server
wsServer = new WebSocketServer({
    httpServer: wshtserver
});

// WebSocket server
let cons = {};
wsServer.on('request', function (request) {
    let connection = request.accept(null, request.origin);
    let id;
    connection.on('message', function (message) {
        //first, which document is this?
        message = message.utf8Data;
        if (message[0] == "!") {
            //it's an id message
            id = message.slice(1);
            if (cons[id]) {
                cons[id].socks.push(connection);
            } else {
                cons[id] = {
                    nano: new nanogram(id),
                    socks: [connection]
                }
                cons[id].nano.on("change", (data) => {
                    for (let i = 0; i < cons[id].socks.length; i++) {
                        cons[id].socks[i].send(JSON.stringify(data));
                    }
                })
            }
        } else {
            // recieve save request
            let save = JSON.parse(message);
            cons[id].nano.fire("newData", save);
        }
    });
    connection.on("close", () => {
        cons.splice(cons.indexOf(connection), 1);
    });
});
