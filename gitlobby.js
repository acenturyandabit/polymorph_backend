/*
constraint 1: SAVES ARE UNIDIRECTIONAL
constraint 2: as lightweight as possible on clients
Trust isn't necessary if both parties can rollback indefinitely
- commit level and file level rollbacks
- trust levels: ignore, retrieve, auto-merge, realtime, realtime override. Configurable per document per peer per backend instance; confs stored server-side.
- if >retrieve: on connect / save broadcast, get all changes and put in conflicts
- if >auto-merge: on connect / save broadcast, perform automerge
- if >realtime: while not conflict, overwrite changes to items
- if realtime override: always overwrite changes to items from realtime (save broadcast behaviour remains the same)
conflicts: 
- for each peer, for each item, store conflicts on backend and pass to frontend. 
- instantly merge rts to conflict storage, then push to client.
- front end menu to fix conflicts + roll back to old version
realtime:
- if RT on client is on: all parties do independent processing (because what if 3 clients?)
- if RT on client is off: all parties do independent processing
- if RT on client goes from off to on: assume doc is the same...
- if save an older version of the doc: ??? 
    - hashes are not stored with items; use git-like commit level and file level
    - hashes are stored with items, keep newer item?
    -- key being, if any client saves, we should be able to retrieve that save based on a commit id
    -- also never want the user to deal with any commit-level clashes
    - server keeps all ctrl s as a commit. 
    -- but what about individual versions? Do they count as commits?
    --- keep a floating "HEAD" commit that is the latest; and then each user ctrl-s / remote ctrl-s is the latest.
    --- but phone gitlite will count everything as a ctrl-s!
    ---- make commits light enough for that not to matter; collate commits by user
file ID: itemID + hash of item + date so that rollbacks can differentiate a rollback
    - stored as b64 encoded version
file pointer: keeps track of all versions of files in this local line.

later:
commit ID: newcommitID + lastcommitID (locally) to assist with own iteration. Scope of commit is purely local.
- commits are only used for rollback purposes.

task on clients:
- host will tell whether the update is a conflict or an overwrite based on settings
- onus on user to regularly save when changes are made [hit autosave if want]
- just render.
-- doesnt that mean we can just use the server? 
-- but gitlite conflicts on client..
- gitline conflicts on client: client can resolve them. 
-- when client resolves conflicts, save the /conflicts:
-- what if two clients both resolve conflicts and neither are realtime? then last one wins. the issue is between host and host.
- conflicts is under _conflicts and is a special item that git reads.
- dict of itemID then remote_host_ID
phone needs to defer to changes somehow: make phone defer by default, but also have rollback capability for phone anyway

storage:
with data:
- conflicts
- data
without data:
- permissions (editable)
- file history (retrieved during rollbacks)
- commit history (retrieved during rollbacks)
- file hashes (retrieved during rollbacks)

Diagram:
https://app.diagrams.net/#G1vneiuzlwwIAqeFWXKr2LFH7fCh8en68g
*/


let path = require("path");
let fs = require("fs");
let nanogram = require("./nanogram");
let pmDataUtils = require("./polymorph_dataUtils");
let WebSocketServer = require('websocket').server;
let http = require('http');

let polymorph_core = {};
pmDataUtils.addDataUtils(polymorph_core);
/*
Tests
- load from remote
- sync two sided
*/

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

let createEncodedHash = (itmid, hash, date = Date.now()) => {
    return Buffer.from(JSON.stringify({ i: itmid, h: hash, d: date })).toString('base64');
}

let fromEncodedHash = (hash) => {
    return JSON.parse(Buffer.from(hash, 'base64').toString());
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
    let commitHistoryPath = `${basepath}/chist.json`; // will this need rewrites: no never
    let commitHeadPath = `${basepath}/chead.json`; //will this need rewrites: yes, frequently
    let settingsPath = `${basepath}/settings.json`; // will this need rewrites: yes, frequently
    let conflictsPath = `${basepath}/conflicts.json`; // will this need rewrites: yes, frequently

    this.headCommit = {
        items: {},
        timestamp: 0
    };
    this.itemChunks = {};
    this.commitHistory = {};
    this.remoteCommitWaiters = {};
    this.remoteCallbacks = {};
    this.settings = {
        permissions: {},
        defaultPermission: "retrieve"
    };

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
                /*files = fs.readdirSync(commitHistoryPath);
                files.filter(i => i.endsWith(".json")).forEach(i => {
                    this.commitHistory[i.slice(0, i.length - 5)] = JSON.parse((fs.readFileSync(commitHistoryPath + "/" + i)).toString());
                });*/
                //TODO: last saved commit should be the thing that no-one points to - iterate over commit history to find it

                //todo: each item to a file is slightly more efficient
                if (fs.existsSync(commitHeadPath)) {
                    this.headCommit = JSON.parse(fs.readFileSync(commitHeadPath).toString());
                }
                if (fs.existsSync(settingsPath)) {
                    Object.assign(this.settings, JSON.parse(fs.readFileSync(settingsPath)));
                }
            } catch (e) {
                console.log(e);
            }
        }
    }


    this.collateForClient = () => {
        if (!this.isLoaded) this.loadFromDisk();
        let doc = {};
        Object.entries(this.headCommit).forEach(i => {
            if (this.itemChunks[i[0]]) {
                doc[i[0]] = this.itemChunks[i[0]][i[1]];
            } else {
                console.log(`err: ${i[0]} not found from hcommit`);
            }
        });
        return doc;
    }

    this.clients = [];

    this.broadcastToClients = (msg) => {
        this.clients = this.clients.filter(i => {
            if (!i.connected) return false;
            else {
                i.send(JSON.stringify(msg));
            }
        })
    }

    this.remotes = [];
    /*
    remote: {
        connection
        id --> maps to settings.permissions[id]
    }

    */
    this.broadcastToRemotes = (msg) => {
        this.remotes = this.remotes.filter(i => {
            if (!i.connected) return false;
            else {
                i.write(JSON.stringify(msg));
            }
        })
    }

    this.processClientUpdate = (msg) => {
        switch (msg.type) {
            case "update":
                // update file history
                let itmEncodedHash = createEncodedHash(msg.data.id, hash(msg.data.data));
                this.itemChunks[msg.data.id].unshift(itmEncodedHash);
                // what about deletions? commits can unlink items and they no longer exist but they exist in older commits. beautiful
                // but item history is permanent... oh no i guess we can flag items as dead? later thing
        }
        this.broadcastToRemotes(msg);
    }

    this.processRemoteUpdate = (msg) => {
        // check permissions
        // update file / conflicts
        // broadcast to all locals
    }

    this.writeToFile = (category, ID) => {

    }

    this.sendToRemote = (id, obj) => {
        obj.docID = this.docID;
        if (this.remotes[id]) {
            this.remotes[id].write(JSON.stringify(obj) + "\n");
        } else {
            console.log(`remote ${id} did not exist!`);
        }
    }
    this.checkEnrolItem = (key, item) => {
        let writeHashedItem = (key, h, item) => {
            this.itemChunks[key][h] = JSON.stringify(item);
            if (!fs.existsSync(itemChunksPath)) {
                fs.mkdirSync(itemChunksPath, { recursive: true });
            }
            if (!fs.existsSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(key) + ".json")) {
                fs.writeFileSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(key) + ".json", JSON.stringify({ h: h, i: item }) + "\n");
            } else {
                fs.appendFileSync(itemChunksPath + "/" + fileNameSafeEscape.encodeFileName(key) + ".json", JSON.stringify({ h: h, i: item }) + "\n");
            }
        }
        let stringedItem = JSON.stringify(item);
        let ihash = hash(stringedItem);
        if (!this.itemChunks[key]) {
            this.itemChunks[key] = {};
        }
        if (!this.itemChunks[key][ihash]) {
            writeHashedItem(key, ihash, item);
        } else {
            let _ihash = ihash;
            let counter = 0;
            while (this.itemChunks[key][_ihash] && JSON.stringify(this.itemChunks[key][_ihash]) != stringedItem) {
                _ihash = ihash + "_" + counter;
                counter++;
            }
            if (!this.itemChunks[key][_ihash]) {
                writeHashedItem(key, _ihash, item);
            }
            ihash = _ihash;
        }
        return ihash;
    }

    this.RTPushChangesLocally = (keys) => {

    }

    this.processItemsAsCommit = (items, source) => {
        if (!this.isLoaded) this.loadFromDisk();
        // add to item history; generate commit
        let commit = {
            source: source,
            timestamp: Date.now(),
            items: {}
        };
        for (let i in items) {
            commit.items[i] = this.checkEnrolItem(i, items[i]);
        }
        //TODO: Write commit to file (append) this.commitHistory[i.slice(0, i.length - 5)] = JSON.parse((fs.readFileSync(commitHistoryPath + "/" + i)).toString());

        //update head if necessary
        if (source == "LOCAL" || this.settings.permissions[source] == "overwrite") {
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
            this.RTPushChangesLocally(changes);
            fs.writeFileSync(commitHeadPath, JSON.stringify(this.headCommit));
        } else if (this.settings.permissions[source] == "conflict") {

        }
        //send the commit to everyone else (todo)
        console.log(this.headCommit);
        // write the head commit
        fs.writeFileSync(commitHeadPath, JSON.stringify(this.headCommit));
    }

    this.attachClient = (client) => {
        this.clients.push(client);
        client.on("message", (data) => {
            this.processClientUpdate(JSON.parse(data.utf8Data));
        })
    }

    this.attachRemote = (connection, ID, soft) => {
        this.remotes[ID] = connection;
        this.remoteCallbacks[ID] = {};
        if (!soft) {
            // check settings of the remote and initiate a pull if we want
            if (!this.settings.permissions[ID]) this.settings.permissions[ID] = "conflict"; // for now
            if (this.settings.permissions[ID] == "overwrite" || this.settings.permissions[ID] == "conflict") {
                //pull changes. what does pull changes mean? 
                this.sendToRemote(ID, { op: "fmMessage", type: "pull" });
            }
        }
    }

    this.handleRemoteMessage = (data, remoteID) => {
        console.log("got a message fr " + remoteID);
        console.log(data)
        switch (data.type) {
            case "fetchHeadCommit":
                //send over my head
                if (!this.isLoaded) this.loadFromDisk();
                console.log(this.headCommit);
                this.sendToRemote(remoteID, {
                    op: "fmMessage",
                    type: "headCommitSend",
                    data: this.headCommit
                }); // more efficient way of doing this is possible but eh for now.
                console.log("sent headcommit to " + remoteID);
                break;
            case "headCommitSend":
                //recieve the head
                if (this.remoteCommitWaiters[remoteID]) {
                    data.data.remote = remoteID;
                    console.log("got headcommit fr " + remoteID);
                    this.remoteCommitWaiters[remoteID](data.data);
                    delete this.remoteCommitWaiters[remoteID];
                }
                break;
            case "pull":
                //send over my head
                this.sendToRemote(remoteID, {
                    op: "fmMessage",
                    type: "pullSend",
                    data: this.collateForClient()
                }); // more efficient way of doing this is possible but eh for now.
                break;
            case "pullSend":
                //recieve the head
                if (this.settings.permissions[remoteID] == "overwrite") {
                    this.processItemsAsCommit(data.data);
                }
                if (this.remoteCallbacks[remoteID]["pull"]) res();
                break;
        }
    }
    this.remoteCommitWaiters = {};
    this.pullFromRemote = async() => {
        console.log("pulling from remote...");
        // pull all overwrite-class heads and use the latest one (store it for retrieval from collate)
        let remotesToPullFrom = [];
        remotesToPullFrom = Object.entries(this.settings.permissions).filter(i => i[1] == "overwrite").map(i => i[0]);
        if (!remotesToPullFrom.length) {
            remotesToPullFrom = Object.entries(this.settings.permissions).filter(i => i[1] == "conflict").map(i => i[0]);
        }
        if (remotesToPullFrom.length) {
            let mostRecents = remotesToPullFrom.map(i => new Promise((res) => {
                this.remoteCommitWaiters[i] = res;
                this.sendToRemote(i, { op: "fmMessage", type: "fetchHeadCommit" });
                console.log("sent fetchhead to " + i);
                setTimeout(() => { res({ timestamp: -1, remote: i }) }, 10000); // 10s timeout
            }));
            mostRecents = await Promise.all(mostRecents);
            console.log("yay i got the commits");
            console.log(mostRecents);
            mostRecents.sort((a, b) => a.timestamp - b.timestamp);
            console.log("pulling from " + mostRecents[0]);
            console.log("pulling from " + mostRecents[0].remote);
            let oldPermission = this.settings.permissions[mostRecents[0].remote]; // if pulling from a conflict source, temporarily allow overwrites so we actually get items
            this.settings.permissions[mostRecents[0].remote] = "overwrite";
            await new Promise((res) => {
                this.remoteCallbacks[mostRecents[0].remote]["pull"] = res;
                this.remotes[mostRecents[0].remote].write(JSON.stringify({ op: "fmMessage", type: "pull" }));
            });
            this.settings.permissions[mostRecents[0].remote] = oldPermission;
        }
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
                res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
            } else {
                //pull from server -- which one? any one, they should be synced
                if (!availList[req.query.f].fileManager) {
                    availList[req.query.f].fileManager = new FileManager(req.query.f, private.baseGitLocation + "/" + req.query.f);
                }
                //temporary overwrite
                await availList[req.query.f].fileManager.pullFromRemote();
                res.send(availList[req.query.f].fileManager.collateForClient());
            }
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
            client.connection.write(JSON.stringify({
                op: "pushAvailList",
                list: Object.values(availList).filter(i => i.type == "local").map(i => {
                    let u = JSON.parse(JSON.stringify(i));
                    delete u.fileManager;
                    return u;
                }),
                RTList: Object.keys(RTmanagers)
            }) + "\n");
            onlineClients[client.id] = client;
            let prevChunk = "";
            client.TCPsources = {};
            client.connection.on("data", async(data) => {
                data = prevChunk + data.toString();
                console.log(data);
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
                        console.log(e);
                        console.log(data);
                    }
                    console.log(data.op, client.id);
                    switch (data.op) {
                        case "pushAvailList":
                            let remoteList = data.list;
                            remoteList = remoteList.map(i => {
                                i.type = "remote";
                                i.hostID = client.id;
                                return i;
                            });
                            for (let i of remoteList) {
                                if (!availList[i.id]) {
                                    availList[i.id] = i;
                                }
                                if (!availList[i.id].fileManager) {
                                    availList[i.id].fileManager = new FileManager(i.id, private.baseGitLocation + "/" + i.id);
                                }
                                availList[i.id].fileManager.attachRemote(client.connection, client.id); // it is responsible for the pull, and setting up listener websockets and whatnot
                            }
                            break;
                        case "fmMessage":
                            // since we only enrol other's remotes, gotta enrol on our side too
                            availList[data.docID].fileManager.attachRemote(client.connection, client.id, true);
                            if (!availList[data.docID]) {
                                availList[data.docID] = {
                                    type: "remote",
                                    hostID: client.id
                                };
                            }
                            if (!availList[data.docID].fileManager) {
                                availList[data.docID].fileManager = new FileManager(data.docID, private.baseGitLocation + "/" + data.docID);
                                availList[data.docID].fileManager.attachRemote(client.connection, client.id);
                            }
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