/*
Item keys
    - Universal scope
Doc ID
    - Universal scope
Doc Time
    - Doc ID scope
Self ID
    - Universal scope
Item hash
    - Item key scope
*/

let fs = require("fs");
let nanogram = require("./nanogram");
let pmDataUtils = require("./polymorph_dataUtils");
let WebSocketServer = require('websocket').server;
let http = require('http');


let polymorph_core = {};
pmDataUtils.addDataUtils(polymorph_core);

let thisServerIdentifier;
if (fs.existsSync("thisServerIdentifier")) {
    thisServerIdentifier = String(fs.readFileSync("thisServerIdentifier"));
} else {
    thisServerIdentifier = String(Date.now());
    fs.writeFileSync("thisServerIdentifier", thisServerIdentifier);
}

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

    let commitsPath = `${basepath}/commits`; // commits
    /*
    /commits
        /<remoteID>
            /chead.json
            /hhead
                /<date>.json
    */
    this._commitsByServer = {};
    this.commitsByServer = new Proxy(this._commitsByServer, {
        get: function(target, remoteID) {
            if (!target[remoteID]) {
                if (!fs.existsSync(commitsPath)) {
                    fs.mkdirSync(commitsPath);
                }
                let folderPath = `${commitsPath}/${fileNameSafeEscape.encodeFileName(remoteID)}`;
                let tmpStorage = {};
                if (fs.existsSync(folderPath)) {
                    if (fs.existsSync(folderPath)) {
                        for (let commit in fs.readdirSync(folderPath)) {
                            if (commit.endsWith(".json")) {
                                tmpStorage[remoteID][commit.slice(0, commit.length - 5)] = JSON.parse(fs.readFileSync(`${folderPath}/${commit}.json`).toString());
                            }
                        };
                    }
                } else {
                    fs.mkdirSync(folderPath);
                }
                target[remoteID] = {
                    commits: tmpStorage,
                    latestCommit: () => {
                        let keys = Object.keys(tmpStorage);
                        keys.sort((a, b) => b - a);
                        if (!keys.length) return {};
                        return tmpStorage[keys[0]];
                    },
                    enrolCommit: (commit) => {
                        //add it to tmpstorage
                        tmpStorage[commit.timestamp] = commit;
                        // write it to file
                        fs.writeFileSync(`${folderPath}/${commit.timestamp}.json`, JSON.stringify(commit));
                    }
                }
            }
            return target[remoteID];
        }
    })
    Object.defineProperty(this, "localhead", {
        get: () => {
            return this.commitsByServer[thisServerIdentifier];
        }
    })

    let itemChunksPath = `${basepath}/ichnk`; // will this need rewrites: no never
    /*
    /ichnk
        /<itemID>.json
            \n {
                h: string
                i: {}
    */
    this._itemChunks = {};
    this.itemChunks = new Proxy(this._itemChunks, {
        get: function(target, itemID) {
            if (!target[itemID]) {
                let filePath = `${itemChunksPath}/${fileNameSafeEscape.encodeFileName(itemID)}.json`;
                if (fs.existsSync(filePath)) {
                    // read all the hashes
                    let itemArray = fs.readFileSync(filePath).toString().split("\n").filter(i => i.length);
                    target[itemID] = itemArray.map(i => JSON.parse(i)).reduce((p, i) => {
                        p[i.h] = i.i;
                        return p;
                    }, {});
                } else {
                    target[itemID] = {};
                }
            }
            return target[itemID];
        }
    })

    /*
    Checks if the itemref with id `id` has a version `item{}` in storage, and enrols it if not.
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

    // Turns commits into a frontend-readable item dictionary
    this.commitToItems = (commit) => {
        let doc = {};
        Object.entries(commit.items).forEach(i => {
            if (this.itemChunks[i[0]]) {
                doc[i[0]] = this.itemChunks[i[0]][i[1]];
            } else {
                console.log(`err: ${i[0]} not found from a commit`);
            }
        });
        return doc;
    }

    // Turns item dictionary into a commit dated now
    this.itemsToCommit = (items, source) => {
            let commit = {
                source: source,
                timestamp: Date.now(),
                items: {}
            };
            // process the items
            for (let i in items) {
                commit.items[i] = this.checkEnrolItem(i, items[i]);
            }
            return commit;
        }
        /*==========================Client management=================================*/
        //Called by the client to save a document
    this.processClientIncoming = (doc) => {
        let commit = this.itemsToCommit(doc);
        let headCommit = this.localhead.latestCommit();
        let mergedCommit = JSON.parse(JSON.stringify(commit));

        let changes = [];
        for (let k in headCommit.items) {
            if (!mergedCommit.items[k] || headCommit.items[k]._lu_ > mergedCommit.items[k]._lu_) {
                mergedCommit.items[k] = headCommit.items[k];
            }
        }
        this.localhead.enrolCommit(commit);
        mergedCommit.timestamp += 1;
        this.localhead.enrolCommit(mergedCommit);
        this.broadcastToRemotes({
            type: "commitList",
            data: Object.keys(this.localhead.commits)
        });
        return mergedCommit;
    }

    this.collateForClient = () => {
        return this.commitToItems(this.localhead.latestCommit());
    }


    /*==========================Remote management=================================*/
    /*
    remote: dict of id to connection
    */
    this.remotes = {};
    this.sendToRemote = (remoteID, obj) => {
        obj.docID = this.docID;
        obj.type = "fmMessage";
        if (this.remotes[remoteID] && this.remotes[remoteID].connection) {
            this.remotes[remoteID].connection.write(JSON.stringify(obj) + "\n");
        } else {
            console.log(`remote ${remoteID} did not exist!`);
        }
    }

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

    this.attachRemote = (connection, remoteID, soft) => {
        this.remotes[remoteID] = {
            connection: connection
        };
        // Start a merge negotiation
        if (!soft) {
            this.sendToRemote(remoteID, { type: "commitList", data: Object.keys(this.localhead.commits) });
        }
    }
    let pullRequestCompletionCallbacks = {};
    // hard pull from remote when we don't have a copy on local
    this.pullFromRemote = async(remoteID) => {
        let doneCallbackID = Date.now();
        return new Promise((res) => {
            pullRequestCompletionCallbacks[doneCallbackID] = res;
            this.sendToRemote(remoteID, { type: "requestCommitList", doneCallbackID: doneCallbackID });
        });
    }

    this.handleRemoteMessage = (data, remoteID) => {
        console.log(`hilagit: ${remoteID} // ${docID} // ${data.type}`);
        switch (data.type) {
            case "requestCommitList":
                //recieved when remote wants to pull our doc for the first time
                this.sendToRemote(remoteID, { type: "commitList", data: Object.keys(this.localhead.commits), doneCallbackID: data.doneCallbackID });
                break;
            case "commitList":
                //Check their commit list against our copy of their remote list
                let ourCopyTheirs = Object.keys(this.commitsByServer[remoteID].commits).reduce((p, i) => ({ i: true, ...p }), {});
                let theirs = data.data.reduce((p, i) => ({ i: true, ...p }), {});
                let toRequest = [];
                for (let i in theirs) {
                    if (!ourCopyTheirs[i]) {
                        toRequest.push(i);
                    }
                }
                this.sendToRemote(remoteID, { type: "requestCommits", data: toRequest, doneCallbackID: data.doneCallbackID });
                break;
            case "requestCommits":
                this.sendToRemote(remoteID, { type: "sendCommits", data: data.data.map(i => this.localhead.commits[i]), doneCallbackID: data.doneCallbackID });
                break;
            case "sendCommits":
                let itemsWeDontHave = [];
                data.data.forEach(i => {
                    for (let itemID in i.items) {
                        if (!this.itemChunks[itemID][i.items[itemID]]) {
                            itemsWeDontHave.push([itemID, i.items[itemID]]);
                        }
                    }
                    this.commitsByServer[remoteID].enrolCommit(i);
                });
                this.sendToRemote(remoteID, { type: "requestItems", data: itemsWeDontHave, doneCallbackID: data.doneCallbackID });
                // figure out what items we don't have yet
                // ask for them
                // save the commits to disk
                break;
            case "requestItems":
                //send over the desired items
                this.sendToRemote(remoteID, {
                    type: "recieveItems",
                    data: data.data.map(i => [i[0], this.itemChunks[i[0]][i[1]]]),
                    doneCallbackID: data.doneCallbackID
                });
                break;
            case "recieveItems":
                data.data.forEach(i => {
                    this.checkEnrolItem(i[0], i[2]);
                });
                if (data.doneCallbackID) {
                    pullRequestCompletionCallbacks[data.doneCallbackID]();
                }
                break;
        }
    };
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
            let result = availList[req.query.f].fileManager.processClientIncoming(polymorph_core.datautils.decompress(req.body), thisServerIdentifier);
            res.status(200).send(JSON.stringify(result));
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

        let nng = new nanogram(undefined, {
            udpPort: 12482,
            callWord: "nanogram_gitlite",
            id: thisServerIdentifier
        });
        // for each new peer, ask what documents they have
        let onlineClients = {};
        let RTmanagers = {};

        let prepareClient = (client) => {
            console.log("glite preparing " + client.id);
            onlineClients[client.id] = client;

            for (let i in availList) {
                // get all my files to send pushes to remotes
                availList[i].fileManager.attachRemote(client.connection, client.id);
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
                prevChunk = datae.pop();
                for (data of datae) {
                    if (!data.length) continue; // trailing ''s
                    try {
                        data = JSON.parse(data.toString());
                    } catch (e) {
                        console.log(`JSON PARSE FAILED! Chunk: ${data.slice(0, 25)}...${data.slice(data.length - 25)}`);
                        break;
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
        if (private.gitWsOn) {
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
}