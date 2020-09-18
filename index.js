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

var app2 = express();
app2.get("*", (req, res) => res.send(`<script>window.location.href="http://localhost:8080"</script>`));
app2.listen(80);

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

let gitdir = ""

// WebSocket server
wsServer.on('request', function (request) {
    let connection = request.accept(null, request.origin);
    let saveF;
    let data;
    let localCopy;
    let lus;
    connection.on('message', function (message) {
        let response = JSON.parse(message.utf8Data);
        console.log(message.utf8Data);
        switch (response.op) {
            case "push":
                // try and find an entry with msg.id
                saveF = String(response.id).replace(/\./g, "_");
                console.log(saveF);
                try {
                    localCopy = JSON.parse(String(fs.readFileSync(private.baseGitLocation + "/" + saveF + ".json")));
                } catch (e) {
                    //save file does not exist, create one
                    connection.send(JSON.stringify({
                        op: "accept",
                        _lu_: 0
                    }));
                    break;
                }
                let wasSent = false;
                for (let i = 0; i < response._lu_.length; i++) {
                    if (localCopy[response._lu_[i].id]._lu_ == response._lu_[i]._lu_) {
                        // accept this
                        connection.send(JSON.stringify({
                            op: "accept",
                            _lu_: localCopy[response._lu_[i].id]._lu_
                        }));
                        wasSent = true;
                        break;
                    }
                }
                if (!wasSent) {
                    // something is probably wrong because thats a lot of unsents
                    //oh well
                    ws.send(JSON.stringify({
                        op: "accept",
                        _lu_: response._lu_[response._lu_.length]._lu_
                    }));
                }
                break;
            case "pull":
                saveF = String(response.id).replace(/\./g, "_");
                try {
                    data = JSON.parse(String(fs.readFileSync(private.baseGitLocation + "/" + saveF + ".json")));
                    lus = Object.entries(data).map((i) => ({ _lu_: i[1]._lu_, id: i[0] }));
                    let pow2 = 0;
                    lus = lus.sort((a, b) => a._lu_ - b._lu_).filter((i, ii) => {
                        if (!(ii % (2 ** pow2)) || ii == lus.length - 1) {
                            pow2++;
                            return true;
                        }
                    });
                    connection.send(JSON.stringify({
                        id: response.id,
                        op: "push",
                        _lu_: lus
                    }));
                } catch (e) {
                    console.log(e);
                    //save file does not exist, create one
                    connection.send(JSON.stringify({
                        op: "reject",
                    }));
                    connection.close();
                    break;
                }
                break;
            case "accept":
                // send over the data
                let dataToSend = lus.filter(i => i._lu_ >= response._lu_).map(i => ({ id: i.id, data: data[i.id] }));
                connection.send(JSON.stringify({
                    op: "transfer",
                    data: dataToSend
                }));
                connection.close();
                break;
            case "transfer":
                if (!localCopy) {
                    localCopy = {};
                }
                console.log(saveF);
                for (let i of response.data) {
                    if (!localCopy[i.id] || localCopy[i.id]._lu_ < i.data._lu_) localCopy[i.id] = i.data;
                }
                fs.writeFileSync(private.baseGitLocation + "/" + saveF + ".json", JSON.stringify(localCopy));
                break;
            case "reject":
                connection.close();
                break;
        }







        /*
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
        }*/
    });
    connection.on("close", () => {
        //cons.splice(cons.indexOf(connection), 1);
    });
});
