let fs = require("fs");
let nanogram = require("./nanogram");
let pmDataUtils = require("./polymorph_dataUtils");
let WebSocketServer = require('websocket').server;
let http = require('http');

let polymorph_core = {};
pmDataUtils.addDataUtils(polymorph_core);

let hash = (str) => {
    var hash = 0;
    if (str.length == 0) {
        return hash;
    }
    for (var i = 0; i < str.length; i++) {
        var char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

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


let fileNameSafeEscape = {
    encodeFileName: (str) => {
        str = str.replace(/_/g, "__");
        str = str.replace(/\//g, "_slash");
        return str;
    },
    decodeFileName: (str) => {
        str = str.replace(/(?<=^|[^_])((?:(?:__)*))_slash/g, "$1/");
        str = str.replace(/__/g, "_");
        return str;
    }
}

function FileManager(docID, basepath) {
    this.docID = docID;
    this.basepath = basepath;

    let itemChunksPath = `${basepath}/ichnk`; // will this need rewrites: no never
    let commitHeadPath = `${basepath}/chead.json`; //will this need rewrites: yes, frequently
    let remoteCommitsPath = `${basepath}/rcomm`; //will this need rewrites: yes, frequently

    this.isLoaded = false;
    this.loadFromDisk = () => {
        this.isLoaded = true;
        // load itemchunks + head items from file
        if (fs.existsSync(basepath)) {
            try {
                let files = fs.readdirSync(itemChunksPath);
                files.filter(i => i.endsWith(".json")).forEach(i => {
                    let itemArray = fs.readFileSync(itemChunksPath + "/" + i).toString().split("\n").filter(i => i.length);
                    let itemDict = itemArray.map(i => JSON.parse(i)).reduce((p, i) => {
                        p[i.h] = i.i;
                        return p;
                    }, {});
                    this.itemChunks[fileNameSafeEscape.decodeFileName(i.slice(0, i.length - 5))] = itemDict;
                });
                //todo: each item to a file is slightly more efficient
                if (fs.existsSync(commitHeadPath)) {
                    this.headCommit = JSON.parse(fs.readFileSync(commitHeadPath).toString());
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    let self = this;
    this._headCommit = {
        items: {},
        timestamp: 0
    };
    this.headCommit = new Proxy(this._headCommit, {
        get: function() {
            if (!self.isLoaded) self.loadFromDisk();
            return Reflect.get(...arguments);
        }
    })
    this._itemChunks = {};
    this.otherCommitCache = {};
    this.itemChunks = new Proxy(this._itemChunks, {
        get: function() {
            if (!self.isLoaded) self.loadFromDisk();
            return Reflect.get(...arguments);
        }
    })

    this.collateForClient = (commit) => {
        if (!commit) commit = this.headCommit;
        console.log("compiling...");
        let doc = {};
        Object.entries(this.headCommit.items).forEach(i => {
            if (this.itemChunks[i[0]]) {
                doc[i[0]] = this.itemChunks[i[0]][i[1]];
            } else {
                console.log(`err: ${i[0]} not found from hcommit`);
            }
        });
        return doc;
    }

    this.processItemsAsCommit = (items, source) => {
        console.log("processing commit");
        // add to item history; generate commit
        let commit = {
            source: source,
            timestamp: Date.now(),
            items: {}
        };
        for (let i in items) {
            commit.items[i] = this.checkEnrolItem(i, items[i]);
        }
        let changes = [];
        for (let k in commit.items) {
            if (!this.headCommit.items[k] || this.headCommit.items[k] != commit.items[k]) {
                this.headCommit.items[k] = commit.items[k];
                changes.push(k);
            }
        }
        for (let k in this.headCommit.items) {
            if (!commit.items[k]) {
                delete this.headCommit.items[k];
                changes.push(k);
            }
        }
        this.headCommit.timestamp = commit.timestamp;
        fs.writeFileSync(commitHeadPath, JSON.stringify(this.headCommit));
        console.log("broadcasting to remotes: ");
        this.broadcastToRemotes({
            op: "fmMessage",
            type: "sendHead",
            data: this.headCommit
        });
    }

    this.collateConflicts = (remote) => {
        console.log("compiling conflicts...");
        if (!this.otherCommitCache[remote]) {
            if (fs.existsSync(basepath + "/" + remote + ".json")) {
                this.otherCommitCache[remote] = JSON.parse(fs.readFileSync(basepath + "/" + remote + ".json"));
            } else {
                this.otherCommitCache[remote] = { items: {} }
            }
        }
        let tmpCache = { items: {} };
        for (let i in this.otherCommitCache[remote].items) {
            if (this.otherCommitCache[remote].items[i] != this.headCommit.items[i]) {
                tmpCache.items[i] = this.otherCommitCache[remote].items[i];
            }
        }
        let intermediateDoc = this.collateForClient(tmpCache);

        //deleted items as well
        for (let i in this.headCommit.items) {
            if (!this.otherCommitCache[remote].items[i]) {
                intermediateDoc.items[i] = {};
            }
        }
        return intermediateDoc;
    }

    /*
    remote: dict of id to connection
    */
    this.remotes = {};

    this.broadcastToRemotes = (obj) => {
        for (let r in this.remotes) {
            try {
                this.sendToRemote(r, obj);
                console.log("sent to " + r);
            } catch (e) {
                console.log(e);
                delete this.remotes[r];
            }
        }
    }

    this.sendToRemote = (id, obj) => {
        obj.docID = this.docID;
        if (this.remotes[id]) {
            this.remotes[id].write(JSON.stringify(obj) + "\n");
        } else {
            console.log(`remote ${id} did not exist!`);
        }
    }

    /*
    Checks if the item with id `id` has a version `item` in storage, and enrols it if not.
    */
    this.checkEnrolItem = (id, item) => {
        let writeHashedItem = (id, h, item) => {
            this.itemChunks[id][h] = item;
            if (!fs.existsSync(itemChunksPath)) {
                fs.mkdirSync(itemChunksPath, { recursive: true });
            }
            if (!fs.existsSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(id) + ".json")) {
                fs.writeFileSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(id) + ".json", JSON.stringify({ h: h, i: item }) + "\n");
            } else {
                fs.appendFileSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(id) + ".json", JSON.stringify({ h: h, i: item }) + "\n");
            }
        }
        let stringedItem = JSON.stringify(item);
        let ihash = hash(stringedItem);
        if (!this.itemChunks[id]) {
            this.itemChunks[id] = {};
        }
        if (!this.itemChunks[id][ihash]) {
            writeHashedItem(id, ihash, item);
        } else {
            let _ihash = ihash;
            let counter = 0;
            while (this.itemChunks[id][_ihash] && JSON.stringify(this.itemChunks[id][_ihash]) != stringedItem) {
                _ihash = ihash + "_" + counter;
                counter++;
            }
            if (!this.itemChunks[id][_ihash]) {
                writeHashedItem(id, _ihash, item);
            }
            ihash = _ihash;
        }
        return ihash;
    }

    this.attachRemote = (connection, ID, soft) => {
        this.remotes[ID] = connection;
        if (!this.remoteCallbacks[ID]) this.remoteCallbacks[ID] = {};
        if (!soft) {
            // check settings of the remote and initiate a pull if we want
            if (!this.settings.permissions[ID]) this.settings.permissions[ID] = "conflict"; // for now
            if (this.settings.permissions[ID] == "overwrite" || this.settings.permissions[ID] == "conflict") {
                //pull changes. what does pull changes mean? 
                this.sendToRemote(ID, { op: "fmMessage", type: "sendHead", data: this.headCommit });
            }
        }
    }

    this.handleRemoteMessage = (data, remoteID) => {
        console.log("got a message fr " + remoteID);
        console.log(data);
        switch (data.type) {
            case "sendHead":
                this.otherCommitCache[remoteID] = data.data;
                fs.writeFileSync(remoteCommitsPath + "/" + remoteID + ".json", JSON.stringify(this.otherCommitCache[remoteID]));
                let itemRequests = [];
                for (let i of this.otherCommitCache[remoteID].items) {
                    if (!this.itemChunks[i][this.otherCommitCache[remoteID].items[i]]) {
                        itemRequests.push([i, this.otherCommitCache[remoteID].items[i]]);
                    }
                }
                this.sendToRemote(remoteID, { op: "fmMessage", type: "requestItems", data: itemRequests });
                break;
            case "requestItems":
                //send over the desired items
                this.sendToRemote(remoteID, {
                    op: "fmMessage",
                    type: "recieveItems",
                    data: data.data.map(i => [i[0], i[1], this.itemChunks[i[0]][i[1]]])
                });
                break;
            case "recieveItems":
                data.data.forEach(i => {
                    this.itemChunks[i[0]][i[1]] = i[2];
                })
                break;
        }
    }
    this.pullFromRemote = (remoteID) => {
        if (!remoteID) remoteID = Object.keys(this.otherCommitCache)[0];
        this.headCommit = JSON.parse(JSON.stringify(this.otherCommitCache[remoteID]));
    }
}


module.exports = {
    prepare: async(app, private) => {
        let availList = {};
        //do an FS sweep
        await (new Promise((res, rej) => {
            //populate local lobby
            fs.readdir(private.baseGitLocation, { withFileTypes: true }, (err, files) => {
                if (err) console.log(err);
                for (let f of files) {
                    if (f.isDirectory()) {
                        availList[f.name] = {
                            id: f.name,
                            type: "local",
                            fileManager: new FileManager(f.name, private.baseGitLocation + "/" + f.name) //lazy load
                        };
                    }
                }
                res();
            });
        }));

        app.get("/globby", async(req, res) => {
            //get more from nanogram
            res.send(JSON.stringify(Object.values(availList).map(i => i.id)));
        });

        app.post("/gitsave", async(req, res) => {
            if (!availList[req.query.f]) {
                availList[req.query.f] = {
                    id: req.query.f,
                    type: "local",
                    fileManager: new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f) //lazy load
                };
            }
            // tell everyone else that I have made a commit and they can add it to their list of commits if they want
            availList[req.query.f].fileManager.processItemsAsCommit(polymorph_core.datautils.decompress(req.body), "LOCAL");
            res.sendStatus(200);
            res.end();
        });

        app.get("/gitload", async(req, res) => {
            console.log("asked for load");
            if (!availList[req.query.f]) {
                res.send(JSON.stringify(defaultBaseDocument(req.query.f)));
                return; // document does not exist, probably bc user added savesource but made no changes and didnt save
            }
            if (availList[req.query.f].type == "local") {
                if (!availList[req.query.f].fileManager) {
                    availList[req.query.f].fileManager = new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f);
                }
                //console.log(availList[req.query.f].fileManager.collateForClient());
                res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
            } else {
                //pull from server -- which one? any one, they should be synced
                if (!availList[req.query.f].fileManager) {
                    availList[req.query.f].fileManager = new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f);
                }
                //temporary overwrite
                await availList[req.query.f].fileManager.pullFromRemote();
                console.log("finished pulling from remote");
                //console.log("final collated was " + JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
                res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
            }
        });

        app.get("/gitconflicts", async(req, res) => {
            console.log("asked for conflicts");
            if (!availList[req.query.f]) {
                res.send(JSON.stringify(defaultBaseDocument(req.query.f)));
                return; // document does not exist, probably bc user added savesource but made no changes and didnt save
            }
            if (!availList[req.query.f].fileManager) {
                res.send("{}");
                return;
            }
            res.send(JSON.stringify(availList[req.query.f].fileManager.collateConflicts()));
        });


        let nng = new nanogram(undefined, {
            udpPort: 12482,
            callWord: "nanogram_gitlite",
        });
        // for each new peer, ask what documents they have
        let onlineClients = {};
        let RTmanagers = {};

        let prepareClient = (client) => {
            console.log("glite preparing " + client.id);
            onlineClients[client.id] = client;

            for (let i in availList) {
                // get all my files to send pushes to remotes
                availList.fileManager.attachRemote(client.connection, client.id);
            }
            let prevChunk = "";
            client.connection.on("data", async(data) => {
                data = prevChunk + data.toString();
                //console.log("nng got " + data);
                if (!data.includes("\n")) {
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
                        console.log(`JSON PARSE FAILED! Chunk: ${data.slice(0,25)}...${data.slice(data.length-25)}`);
                    }
                    console.log(data.op, client.id);
                    switch (data.op) {
                        case "fmMessage":
                            if (!availList[data.docID]) {
                                availList[data.docID] = {
                                    type: "remote",
                                    hostID: client.id,
                                    fileManager: new FileManager(data.docID, private.baseGitLocation + "/" + data.docID)
                                }
                            }
                            // since we only enrol other's remotes, gotta enrol on our side too
                            // don't need to send message over since should have done that earlier
                            availList[data.docID].fileManager.attachRemote(client.connection, client.id, true);
                            availList[data.docID].fileManager.handleRemoteMessage(data, client.id);
                            break;
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

        // create websocket server for the frontend
        let wshtserver = http.createServer(function(request, response) {});
        wshtserver.listen(29384, function() {});

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
                    if (!availList[m.data]) {
                        availList[m.data] = availList[req.query.f] = {
                            id: req.query.f,
                            type: "local",
                            fileManager: new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f) //lazy load
                        };
                    }
                    if (availList[m.data].fileManager) {
                        availList[m.data].fileManager = new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f);
                    }
                    availList[m.data].fileManager.attachFrontClient(connection);
                }
            })
        })
    }
}