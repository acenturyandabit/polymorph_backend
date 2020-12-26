let path = require("path");
let fs = require("fs");
let nanogram = require("./nanogram");
let pmDataUtils = require("./polymorph_dataUtils");
let WebSocketServer = require('websocket').server;
let http = require('http');
const { tmpdir } = require("os");

let polymorph_core = {};
pmDataUtils.addDataUtils(polymorph_core);
/*
Tests
- load from remote
- sync two sided
*/

function defaultBaseDocument(id) {
    return ({
        "_meta": {
            "displayName": "New Polymorph Document",
            "id": id,
            "contextMenuItems": ["Delete::polymorph_core.deleteItem", "Background::item.edit(style.background)", "Foreground::item.edit(style.color)"],
            "_lu_": 0,
            "currentView": "default_container",
            "globalContextMenuOptions": ["Style::Item Background::item.edit(item.style.background)", "Style::Text color::item.edit(item.style.color)"]
        },
        "default_container": {
            "_rd": { "x": 0, "f": 0, "ps": 1, "s": "default_operator" },
            "_lu_": 0
        },
        "default_operator": {
            "_od": {
                "t": "welcome",
                "data": {},
                "inputRemaps": {},
                "outputRemaps": {},
                "tabbarName": "Home",
                "p": "default_container"
            },
            "_lu_": 0
        }
    })
}

let addEventAPI = (itm, errf = console.error) => {
    itm.events = {};
    itm.fire = function(e, args) {
        let _e = e.split(",");
        let _oe = e.split(","); //original elevents
        _e.push("*"); // a wildcard event listener
        _e.forEach((i) => {
            if (!itm.events[i]) return;
            //prime the ketching function with a starter object to prime it.
            let cnt = true;
            if (itm.events[i].cetches) itm.events[i].cetches.forEach((f) => {
                if (cnt != false) cnt = f(args, true, e)
            });
            //fire each event
            if (itm.events[i].events) {
                itm.events[i].events.forEach((f) => {
                    if (cnt == false) return;
                    try {
                        result = f(args, _oe);
                        if (itm.events[i].cetches) itm.events[i].cetches.forEach((f) => {
                            if (cnt != false) cnt = f(result, undefined, i)
                        });
                    } catch (er) {
                        errf(er);
                    }

                });
            }
            if (itm.events[i].cetches) itm.events[i].cetches.forEach((f) => (f(args, false, e)));
        })
    };
    itm.on = function(e, f) {
        let _e = e.split(',');
        _e.forEach((i) => {
            if (!itm.events[i]) itm.events[i] = {};
            if (!itm.events[i].events) itm.events[i].events = [];
            itm.events[i].events.push(f);
        })
    };
    itm.cetch = function(i, f) {
        if (!itm.events[i]) itm.events[i] = {};
        if (!itm.events[i].cetches) itm.events[i].cetches = [];
        itm.events[i].cetches.push(f);
    }
}


function RTmanager() {
    this.localCopy = {};
    this.encache = (data) => {
        this.localCopy = data;
    }
    this.sources = [];

    this.broadcast = (data) => {
        this.sources = this.sources.filter(i => {
            try {
                i.send(JSON.stringify(data));
                return true;
            } catch (e) {
                return false;
            }
        })
    }

    this.attach = (source) => {
        console.log("attaching source of type " + source.__proto__.constructor.name);
        this.sources.push(source);
        source.on("message", (data) => {
            data = JSON.parse(data.utf8Data);
            let broadcastItems = [];
            let requestItems = [];
            switch (data.type) {
                case "mergeCheck":
                    for (let i = 0; i < data.items.length; i++) {
                        if (this.localCopy[data.items[i].id] && data.items[i]._lu_ == this.localCopy[data.items[i].id]._lu_) {
                            //send over the items from this point
                            let toSend = Object.entries(this.localCopy);
                            toSend = toSend.filter(it => it[1]._lu_ >= data.items[i]._lu_);
                            source.send(JSON.stringify({
                                type: "transmit",
                                data: toSend
                            }))
                            break;
                        }
                    }
                    break;
                case "request":
                    // send over my copy of stuff
                    source.send(JSON.stringify({
                        type: "transmit",
                        data: data.data.map(i => [i, this.localCopy[i]])
                    }));
                    break;
                case "transmit":
                    for (let i of data.data) {
                        if (!this.localCopy[i[0]] || this.localCopy[i[0]]._lu_ < i[1]._lu_) {
                            this.localCopy[i[0]] = i[1];
                            broadcastItems.push(i);
                            //console.log("broadcasting changes at " + i[0]);
                        }
                    }
                    if (broadcastItems.length) {
                        this.broadcast({
                            type: "transmit",
                            data: broadcastItems
                        });
                    }
                    // decide whether or not to merge
                    break;
                case "postUpdate":
                    for (let i of data.data) {
                        if (!this.localCopy[i[0]] || i[1] > this.localCopy[i[0]]._lu_) {
                            if (i[2]) {
                                this.localCopy[i[0]] = i[2];
                                broadcastItems.push([i[0], i[2]]);
                                //console.log("broadcasting changes at " + i[0]);
                            } else {
                                requestItems.push(i[0]);
                                //console.log("requesting changes at " + i[0]);
                            }
                        }
                    }
                    if (broadcastItems.length) {
                        this.broadcast({
                            type: "transmit",
                            data: broadcastItems
                        });

                    }
                    if (requestItems.length) {
                        source.send(JSON.stringify({
                            type: "request",
                            data: requestItems
                        }));
                    }
                    break;
            }
        });
        this.sendMergeRequest(source);
        source.on("error", () => {
            console.log("nanogram sent an error")
                // if something bad happens to the source, abandon it.
            this.sources.splice(this.sources.indexOf(source), 1);
        });
    }
    this.sendMergeRequest = (source) => {
        let timekeys = Object.entries(this.localCopy).map((i) => ({ _lu_: i[1]._lu_, id: i[0] })).sort((a, b) => b._lu_ - a._lu_);
        let pow2 = 0;
        let lus = timekeys.filter((i, ii) => {
            if (!(ii % (2 ** pow2)) || ii == timekeys.length - 1) {
                pow2++;
                return true;
            } else return false;
        });
        source.send(JSON.stringify({
            type: "mergeCheck",
            items: lus
        }))
    }
}

function TCPsource(tcpconn, id) {
    addEventAPI(this);
    this.send = (data) => {
        data = JSON.parse(data);
        data.docID = id;
        data.op = "RTmsg";
        data = JSON.stringify(data);
        tcpconn.write(data + "\n");
        console.log("i reckon i sent a message");
    }
    tcpconn.on("error", (e) => {
        this.fire("error", e);
        console.log("err fired upon")
    });
}

module.exports = {
    prepare: async(app, private) => {
        let availList = {};
        //do an FS sweep
        async function loadFile(f, decompress) {
            return new Promise((res) => {
                let saveF = String(f).replace(/\./g, "_");
                if (!fs.existsSync(private.lobbyFileLocation + "/" + saveF)) res(defaultBaseDocument(f));
                fs.readdir(private.lobbyFileLocation + "/" + saveF, (err, files) => {
                    if (err || files.length == 0) {
                        res(undefined);
                        console.log(err);
                    } else {
                        latestTime = 0;
                        files.forEach(i => {
                            //console.log(i);
                            let lastTimeRe = /.+?(\d+)\.json/.exec(i);
                            if (lastTimeRe) {
                                let lastTime = Number(lastTimeRe[1]);
                                if (lastTime > latestTime) {
                                    latestTime = lastTime;
                                }
                            }
                        });
                        if (latestTime != 0) {
                            fs.readFile(path.join(private.lobbyFileLocation + "/" + saveF, saveF + "_" + latestTime + ".json"), (err, data) => {
                                if (!data) return; // somehow files get deleted after they're made? how?
                                data = data.toString();
                                if (err) {
                                    res(undefined);
                                    console.log(err);
                                } else {
                                    if (decompress) {
                                        try {
                                            res(polymorph_core.datautils.decompress(JSON.parse(data)));
                                        } catch (e) {
                                            console.log(e);
                                            console.log(data);
                                            res(undefined);
                                        }
                                    } else {
                                        res(JSON.parse(data));
                                    }
                                }
                            });
                        } else {
                            res(undefined);
                        }
                    }
                })
            })
        }

        async function saveFile(f, data) {
            return new Promise((res) => {
                let saveF = String(f).replace(/\./g, "_");
                try {
                    fs.mkdirSync(private.lobbyFileLocation + "/" + saveF);
                } catch (e) {
                    //directory exists, ignore
                }
                let file = private.lobbyFileLocation + `/${saveF}/${saveF}_${Date.now()}.json`;
                fs.writeFile(file, JSON.stringify(data), (e) => {
                    console.log(e || file);
                    res(undefined);
                });
                if (private.storageSaver) {
                    console.log("cleaning up...");
                    fs.readdir(private.lobbyFileLocation + "/" + saveF, (err, files) => {
                        if (err || files.length == 0) {
                            return;
                        } else {
                            toDelete = files.map(i => {
                                let lastTimeRe = /.+?(\d+)\.json/.exec(i);
                                if (lastTimeRe) {
                                    lastTimeRe = Number(lastTimeRe[1]);
                                } else {
                                    lastTimeRe = 0;
                                }
                                return {
                                    name: i,
                                    time: lastTimeRe
                                }
                            });
                            toDelete.sort((a, b) => b.time - a.time);
                            toDelete = toDelete.filter((v, i) => i > 10).map(i => i.name);
                            console.log(toDelete);
                            toDelete.forEach(i => fs.unlink(private.lobbyFileLocation + "/" + saveF + "/" + i, () => {}));
                        }
                    });
                }
            })
        }

        await (new Promise((res, rej) => {
            fs.readdir(private.lobbyFileLocation, { withFileTypes: true }, (err, files) => {
                for (let f of files) {
                    if (f.isDirectory()) {
                        availList[f.name] = {
                            id: f.name,
                            type: "local"
                        };
                    }
                }
                res();
            });
        }));

        app.get("/lobby", async(req, res) => {
            //get more from nanogram
            res.send(JSON.stringify(Object.values(availList).map(i => i.id)));
        });

        app.post("/lobbysave", async(req, res) => {
            await saveFile(req.query.f, req.body);
            res.sendStatus(200);
            res.end();
            //also force merge
            if (!availList[req.query.f]) {
                availList[req.query.f] = {
                    id: req.query.f,
                    type: "local"
                }
            }
            // if the document comes from someone else, patch it
            if (availList[req.query.f].externHosts) {
                availList[req.query.f].externHosts = availList[req.query.f].externHosts.filter(h => {
                    if (onlineClients[h]) {
                        let localCopy = polymorph_core.datautils.decompress(req.body);
                        let timekeys = Object.entries(localCopy).map((i) => ({ _lu_: i[1]._lu_, id: i[0] })).sort((a, b) => b._lu_ - a._lu_);
                        let pow2 = 0;
                        let lus = timekeys.filter((i, ii) => {
                            if (!(ii % (2 ** pow2)) || ii == timekeys.length - 1) {
                                pow2++;
                                return true;
                            } else return false;
                        });
                        onlineClients[h].connection.write(JSON.stringify({
                            op: "mergeStart",
                            files: [{
                                id: req.query.f,
                                changes: lus
                            }]
                        }) + "\n");
                        return true;
                    } else {
                        return false;
                    }
                })
            }
            // tell all our friends that we have a new document
            for (let cl in onlineClients) {
                onlineClients[cl].connection.write(JSON.stringify({
                    op: "pushAvailListC",
                    list: [req.query.f]
                }) + "\n")
            }
        });

        app.get("/lobbyload", async(req, res) => {
            if (!availList[req.query.f]) {
                res.send(JSON.stringify(defaultBaseDocument(req.query.f)));
                return; // document does not exist, probably bc user added savesource but made no changes and didnt save
            }
            if (availList[req.query.f].type == "local") {
                let tmpDoc = await loadFile(req.query.f);
                if (!tmpDoc) tmpDoc = defaultBaseDocument(req.query.f);
                console.log("got here, tmpdoc was " + JSON.stringify(tmpDoc));
                res.send(JSON.stringify(tmpDoc));
            } else {
                //pull from server -- which one? any one, they should be synced
                while (availList[req.query.f].externHosts.length && !onlineClients[availList[req.query.f].externHosts[0]]) {
                    availList[req.query.f].externHosts.shift();
                }
                if (!availList[req.query.f].externHosts.length) {
                    res.send("undefined");
                    res.end();
                    return;
                }
                onlineClients[availList[req.query.f].externHosts[0]].connection.write(JSON.stringify({
                    op: "mergeStart",
                    files: [{
                        id: req.query.f,
                        changes: []
                    }]
                }) + "\n");
                //wait until transfer complete to resolve
                await new Promise((res) => {
                    if (!availList[req.query.f].resolutions) availList[req.query.f].resolutions = [];
                    availList[req.query.f].resolutions.push(res);
                });
                res.send(JSON.stringify(await loadFile(req.query.f)));
                res.end();
            }
        });



        let nng = new nanogram();
        // for each new peer, ask what documents they have
        let onlineClients = {};
        let RTmanagers = {};

        let prepareClient = (client) => {
            console.log("preparing " + client.id);
            let unhandledCommons = [];
            if (client.state == "begin") {
                client.connection.write(JSON.stringify({
                    op: "pushAvailListA",
                    list: Object.values(availList).filter(i => i.type == "local"),
                    RTList: Object.keys(RTmanagers)
                }) + "\n");
            }
            onlineClients[client.id] = client;
            let prevChunk = "";
            client.TCPsources = {};
            client.connection.on("data", async(data) => {
                data = prevChunk + data.toString();
                if (!data.endsWith("\n")) {
                    prevChunk = data;
                    return;
                }
                prevChunk = "";
                datae = data.split("\n");
                for (data of datae) {
                    if (!data.length) continue; // trailing ''s
                    try {
                        data = JSON.parse(data.toString());
                    } catch (e) {
                        console.log(e);
                        console.log(data);
                    }
                    console.log(data.op, client.id);
                    let composedMessage;
                    switch (data.op) {
                        //do stuff
                        case "pushAvailListA":
                            client.connection.write(JSON.stringify({
                                op: "pushAvailListB",
                                list: Object.values(availList).filter(i => i.type == "local"),
                                RTList: Object.keys(RTmanagers)
                            }) + "\n");
                            //fall through
                        case "pushAvailListB":
                        case "pushAvailListC":
                            composedMessage = {
                                op: "mergeStart",
                                files: []
                            };
                            let remoteList = data.list;
                            remoteList = remoteList.map(i => {
                                i.type = "remote";
                                i.hostID = client.id;
                                return i;
                            });
                            if (data.op == "pushAvailListC") {
                                break;
                            }
                            let commons = [];
                            for (let i of remoteList) {
                                if (availList[i.id]) {
                                    if (availList[i.id].type == "local") {
                                        commons.push(i.id);
                                    }
                                } else {
                                    availList[i.id] = i;
                                }
                                if (!availList[i.id].externHosts) availList[i.id].externHosts = [];
                                availList[i.id].externHosts.push(client.id);
                                if (RTmanagers[i.id]) {
                                    RTmanagers[i.id].attach(new TCPsource(client.connection, i.id));
                                }
                            }

                            for (let i of data.RTList) {
                                if (RTmanagers[i]) {
                                    RTmanagers[i].attach(new TCPsource(client.connection, i));
                                }
                            }

                            if (data.op == "pushAvailListB") {
                                for (let f of commons) {
                                    let localCopy = await loadFile(f, true);
                                    let timekeys = Object.entries(localCopy).map((i) => ({ _lu_: i[1]._lu_, id: i[0] })).sort((a, b) => b._lu_ - a._lu_);
                                    let pow2 = 0;
                                    let lus = timekeys.filter((i, ii) => {
                                        if (!(ii % (2 ** pow2)) || ii == timekeys.length - 1) {
                                            pow2++;
                                            return true;
                                        } else return false;
                                    });
                                    composedMessage.files.push({
                                        id: f,
                                        changes: lus
                                    })
                                }
                                client.connection.write(JSON.stringify(composedMessage) + "\n");
                                //push over commons
                            }
                            break;
                        case "mergeStart":
                            // try and find an entry with msg.id
                            composedMessage = {
                                op: "mergeContinue",
                                files: []
                            };
                            for (let f of data.files) {
                                let localCopy = await loadFile(f.id, true);
                                if (!localCopy) {
                                    //this needs to write from scratch
                                    console.log("yes mistake was here");
                                }
                                let timekeys = Object.entries(localCopy).map((i) => ({ _lu_: i[1]._lu_, id: i[0] })).sort((a, b) => b._lu_ - a._lu_);
                                let wasSent = false;
                                for (let i = 0; i < f.changes.length; i++) {
                                    if (localCopy[f.changes[i].id] && localCopy[f.changes[i].id]._lu_ == f.changes[i]._lu_) {
                                        let lastTime = localCopy[f.changes[i].id]._lu_;
                                        timekeys = timekeys.filter(i => i._lu_ >= lastTime).map(i => ({
                                            id: i.id,
                                            data: localCopy[i.id]
                                        }));
                                        console.log("lasttime was " + lastTime + " on file " + f.id);
                                        console.log("total changes:" + timekeys.length);
                                        composedMessage.files.push({
                                            id: f.id,
                                            changes: timekeys,
                                            commonLu: lastTime
                                        });
                                        wasSent = true;
                                        break;
                                    } else {
                                        console.log(f.changes[i].id);
                                    }
                                }
                                if (!wasSent) {
                                    //send everything
                                    composedMessage.files.push({
                                        id: f.id,
                                        changes: Object.entries(localCopy).map(i => ({
                                            id: i[0],
                                            data: i[1]
                                        })),
                                        commonLu: 0
                                    })
                                }
                            }
                            client.connection.write(JSON.stringify(composedMessage) + "\n");
                            break;
                        case "mergeContinue":
                            composedMessage = {
                                op: "mergeFinish",
                                files: []
                            };
                            for (let f of data.files) {
                                let localCopy = await loadFile(f.id, true);
                                let timekeys = Object.entries(localCopy).map((i) => ({ _lu_: i[1]._lu_, id: i[0] })).sort((a, b) => b._lu_ - a._lu_);
                                composedMessage.files.push({
                                    id: f.id,
                                    changes: timekeys.filter(i => i._lu_ >= f.commonLu).map(i => ({
                                        id: i.id,
                                        data: localCopy[i.id]
                                    }))
                                })
                            }
                            client.connection.write(JSON.stringify(composedMessage) + "\n");
                            //fall through
                        case "mergeFinish":
                            //merge changes
                            for (let f of data.files) {
                                let localCopy = await loadFile(f.id, true);
                                for (let c of f.changes) {
                                    if (!localCopy[c.id] || localCopy[c.id]._lu_ < c.data._lu_) {
                                        localCopy[c.id] = c.data;
                                    }
                                }
                                saveFile(f.id, localCopy);
                                if (availList[f.id].resolutions) {
                                    availList[f.id].resolutions.forEach(i => i());
                                    availList[f.id].resolutions = [];
                                }
                                availList[f.id].type = "local";
                            }
                            break;
                        case "RTmsg":
                            if (!RTmanagers[data.docID]) {
                                RTmanagers[data.docID] = new RTmanager();
                                RTmanagers[data.docID].encache(await loadFile(data.docID, true));
                            }
                            if (!client.TCPsources[data.docID]) {
                                client.TCPsources[data.docID] = new TCPsource(client.connection, data.docID);
                                RTmanagers[data.docID].attach(client.TCPsources[data.docID]);
                            }
                            client.TCPsources[data.docID].fire("message", { utf8Data: JSON.stringify(data) });
                    }
                }
            });
            client.connection.on("error", async(e) => {
                //probably an errconreset
                delete onlineClients[client.id];
                console.log("closed " + client.id + " ," + e);
                await nng.connectTo(client.id);
            })
            client.connection.on("close", async(e) => {
                delete onlineClients[client.id];
                console.log("closed " + client.id + " ," + e);
                await nng.connectTo(client.id);
            })
        }
        nng.on("newPeer", async(id) => {
            console.log("i have a friend" + id);
            client = await nng.connectTo(id);
            prepareClient(client);
        });

        nng.on("lostPeer", async(id) => {
            console.log("i lost a friend" + id);
            // the friend should go now
        });

        let wshtserver = http.createServer(function(request, response) {});
        wshtserver.listen(18036, function() {});

        // create the server
        wsServer = new WebSocketServer({
            httpServer: wshtserver,
            maxReceivedFrameSize: 10000000,
            maxReceivedMessageSize: 10000000
        });

        wsServer.on('request', (rq) => {
            let connection = rq.accept(null, rq.origin);
            connection.on("message", async(m) => {
                m = JSON.parse(m.utf8Data);
                if (m.type == "selfID") {
                    if (!RTmanagers[m.data]) {
                        RTmanagers[m.data] = new RTmanager();
                        let tmpFile = await loadFile(m.data, true);
                        if (tmpFile) RTmanagers[m.data].encache(tmpFile);
                    }
                    if (!availList[m.data]) {
                        availList[m.data] = { id: m.data, type: "local" }
                    }
                    if (availList[m.data].externHosts) {
                        availList[m.data].externHosts.filter(i => {
                            if (onlineClients[i]) {
                                if (!onlineClients[i].TCPsources[m.data]) {
                                    onlineClients[i].TCPsources[m.data] = new TCPsource(onlineClients[i].connection, m.data);
                                }
                                RTmanagers[m.data].attach(onlineClients[i].TCPsources[m.data]);
                                RTmanagers[m.data].sendMergeRequest(onlineClients[i].TCPsources[m.data]);
                                return true;
                            } else {
                                return false;
                            }
                        })
                    }
                    RTmanagers[m.data].attach(connection);
                }
            })
        })
    }
}