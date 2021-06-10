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

let nng; // storage for nanogram

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
    this.commits = {};
    if (!fs.existsSync(basepath)) {
        fs.mkdirSync(basepath);
    }
    if (!fs.existsSync(commitsPath)) {
        fs.mkdirSync(commitsPath);
    }
    for (let commit of fs.readdirSync(commitsPath)) {
        if (commit.endsWith(".json")) {
            this.commits[commit.slice(0, commit.length - 5)] = JSON.parse(fs.readFileSync(`${commitsPath}/${commit}`).toString());
        }
    };
    this.getLatestCommitFrom = (remoteID) => {
        let list = [];
        for (let i in this.commits) {
            if (this.commits[i].source == remoteID) {
                list.push(this.commits[i]);
            }
        }
        if (!list.length) {
            console.log("latest commit was blank");
            return this.enrolCommit(this.itemsToCommit(defaultBaseDocument(docID), remoteID, true));
        }
        list.sort((a, b) => b.timestamp - a.timestamp);
        return list[0];
    }
    Object.defineProperty(this, "headCommit", {
        get: () => {
            return this.getLatestCommitFrom(thisServerIdentifier);
        },
    });
    Object.defineProperty(this, "headBaseCommitID", {
        get: () => {
            console.log(`headcommit was ${this.headCommit.timestamp}, basecommit was ${this.headCommit.baseCommit}`);
            if (this.headCommit.baseCommit) return this.headCommit.baseCommit;
            else return this.headCommit.timestamp;
        }
    });
    this.enrolCommit = (commit) => {
        // assuming commit is already compressed
        //console.log(`enrolled commit ${commit.timestamp}`);
        this.commits[commit.timestamp] = commit;
        fs.writeFileSync(`${commitsPath}/${commit.timestamp}.json`, JSON.stringify(commit));
        return commit;
    }

    let itemChunksPath = `${basepath}/ichnk`; // will this need rewrites: no never
    /*
    /ichnk
        /<itemID>.json
            \n { // the actual item
                _lu_: date
                ...: ...
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
        if (!item) {
            console.log(`ERR: ${docID} got empty for ${id}, used default zeros`);
            item = { "_lu_": 0 };
        }
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
        if (typeof item != "object") {
            console.log(`ERR: ${docID} :: ${id} was a ${typeof item} (${item})`);
            return undefined;
        }
        if (!("_lu_" in item)) {
            console.log(`ERR: ${docID} had no _lu_ for ${id}, using now`);
            item._lu_ = Date.now();
        }
        let stringedItem = JSON.stringify(item);
        let ihash = item._lu_;
        if (!this.itemChunks[id][ihash]) {
            writeHashedItem(id, ihash, item);
        } else {
            let _ihash = ihash;
            // TODO: deal with the case where two items have the same _lu_ using a method that is consistent across servers (e.g. write A first then B == write B first then A)
            // Also: deal with what happens when a BASE commit gets overwritten
            while (this.itemChunks[id][_ihash] && JSON.stringify(this.itemChunks[id][_ihash]) != stringedItem) {
                _ihash = _ihash + 1;
            }
            if (!this.itemChunks[id][_ihash]) {
                writeHashedItem(id, _ihash, item);
            }
            ihash = _ihash;
        }
        return ihash;
    }

    this.getInflatedCommit = (commit) => {
        console.log(`inflating ${commit.timestamp} off head ${commit.baseCommit}`);
        if (!commit.baseCommit) return commit;
        let inflatedCommit = JSON.parse(JSON.stringify(this.commits[commit.baseCommit]));
        Object.assign(inflatedCommit.items, commit.items);
        return inflatedCommit;
    }

    // Turns commits into a frontend-readable item dictionary
    this.commitToItems = (commit) => {
        let inflatedCommit = this.getInflatedCommit(commit);
        let doc = {};
        // flesh out the commit by inflating it based on its precursor
        Object.entries(inflatedCommit.items).forEach(i => {
            if (this.itemChunks[i[0]]) {
                if (!this.itemChunks[i[0]][i[1]]) {
                    console.log(`err: ${i[1]} in ${i[0]} does not exist, but ${i[0]} is ${JSON.stringify(this.itemChunks[i[0]]).slice(10)}`);
                } else {
                    doc[i[0]] = this.itemChunks[i[0]][i[1]];
                }
            } else {
                console.log(`err: ${i[0]} not found from a commit`);
            }
        });
        return doc;
    }

    this.compressCommit = (commit) => {
        if (!commit.baseCommit) commit.baseCommit = this.headBaseCommitID;
        console.log(`compressing ${commit.timestamp} against ${commit.baseCommit} `)
            // delete items that are common to the headBaseCommit
        let cachedFullItems = JSON.parse(JSON.stringify(commit.items));
        console.log(`cachedFullitems: ${Object.keys(cachedFullItems).length} initial keys: ${Object.keys(commit.items).length} `)

        if (!this.commits[commit.baseCommit]) {
            console.log(`ERR: baseCommit ${commit.baseCommit} for ${commit.timestamp} did not exist. skipping compression.`);
            commit.baseCommit = "";
            return commit;
        }
        let headBase = this.commits[commit.baseCommit].items;
        let itemTotal = Object.keys(commit.items).length;
        let itemSavings = 0;
        if (headBase) {
            for (let i in headBase) {
                if (commit.items[i] == headBase[i]) {
                    delete commit.items[i];
                    itemSavings++;
                }
            }
        }
        console.log(`saved ${itemSavings}/${itemTotal} items`);
        // count keys, if more than n/4 keys diff, rewrite
        // n/4 is arbitrary, but should be dependent on n.
        console.log(`${Object.keys(commit.items).length} vs ${Object.keys(this.commits[commit.baseCommit].items).length}`);
        if (Object.keys(commit.items).length > Object.keys(this.commits[commit.baseCommit].items).length / 4) {
            console.log("override done");
            console.log(`cachedFullitems: ${Object.keys(cachedFullItems).length} initial keys: ${Object.keys(commit.items).length} `)
            commit.items = cachedFullItems;
            console.log(`cachedFullitems: ${Object.keys(cachedFullItems).length} initial keys: ${Object.keys(commit.items).length} `)
            commit.baseCommit = "";
        }
        return commit;
    }

    // Turns item dictionary into a commit dated now
    // dontCompress is true when initializing an empty doc, otherwise inf loop will result with headBaseCommitID getter
    this.itemsToCommit = (items, source, dontCompress) => {
        let commit = {
            source: source,
            timestamp: Date.now(),
            items: {},
            baseCommit: ""
        };
        // process the items
        for (let i in items) {
            let itemID = this.checkEnrolItem(i, items[i]);
            if (itemID) commit.items[i] = itemID;
        }
        if (!dontCompress) this.compressCommit(commit);
        else commit.timestamp = 0; // dontcompress means we are using default doc which should set timestamp to zero
        return commit;
    }

    /*==========================Client management=================================*/
    //Called by the client to save a document
    this.processClientIncoming = (doc) => {
        let commit = this.itemsToCommit(doc, thisServerIdentifier);
        let headCommit = this.getLatestCommitFrom(thisServerIdentifier);
        let mergedCommit = JSON.parse(JSON.stringify(commit));
        let headItems = this.commitToItems(headCommit);
        let shouldSaveMerged = false;
        for (let k in headItems) {
            if (!doc[k] || headItems[k]._lu_ > doc[k]._lu_) {
                mergedCommit.items[k] = headCommit.items[k];
                shouldSaveMerged = true;
                console.log(`${docID} client merge updated ${k}`);
            }
        }
        let shouldSaveIncoming = false;
        for (let c in commit.items) {
            if (!headItems[c] || headItems[c]._lu_ < commit.items[c]) {
                shouldSaveIncoming = true;
            }
        }
        // orignal commit might be newest tho so save it
        if (shouldSaveIncoming) {
            this.enrolCommit(commit);
        }
        if (shouldSaveMerged) {
            // something has changed, so actually save stuff
            // edit the timestamp so it doesn't conflict with the incoming
            mergedCommit.timestamp += 1;
            this.enrolCommit(mergedCommit);
        }
        if (shouldSaveMerged || shouldSaveIncoming) {
            this.broadcastToRemotes({
                type: "commitList",
                data: Object.keys(this.commits)
            });
        }
        return this.commitToItems(mergedCommit);
    }

    this.collateForClient = () => {
        let headCommit = this.getLatestCommitFrom(thisServerIdentifier);
        console.log(headCommit.timestamp);
        return this.commitToItems(headCommit);
    }


    /*==========================Remote management=================================*/
    /*
    remote: dict of id to connection
    */
    this.remotes = {};
    this.sendToRemote = (remoteID, obj) => {
        obj.docID = this.docID;
        obj.op = "fmMessage";
        if (this.remotes[remoteID] && this.remotes[remoteID].connection) {
            try {
                let resend = () => {
                    //console.log(`hilagit send:  ${remoteID} // ${docID} // ${obj.type} // ${JSON.stringify(obj).slice(0, 10)}`);
                    this.remotes[remoteID].connection.write(JSON.stringify(obj) + "\n");
                    if (!this.remotes[remoteID].firstMessageSentOK) {
                        setTimeout(() => {
                            if (!this.remotes[remoteID].firstMessageSentOK) {
                                // something's gone wrong, ask nanogram to close the connection
                                this.remotes[remoteID].connection.end();
                                nng.connectTo(remoteID);
                            }
                        }, 2000);
                    }
                }
                resend();

            } catch (e) {
                console.log(`${docID}: Remote ${remoteID} stream closed.`);
                delete this.remotes[remoteID];
            }
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
            this.sendToRemote(remoteID, { type: "commitList", data: Object.keys(this.commits) });
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
        //console.log(`hilagit recv:  ${remoteID} // ${docID} // ${data.type} // ${JSON.stringify(data.data).slice(0, 10)}`);
        this.remotes[remoteID].firstMessageSentOK = true;
        switch (data.type) {
            case "requestCommitList":
                //recieved when remote wants to pull our doc for the first time
                this.sendToRemote(remoteID, { type: "commitList", data: Object.keys(this.commits), doneCallbackID: data.doneCallbackID });
                break;
            case "commitList":
                //Check their commit list against our copy of their remote list
                let ourCopyTheirs = Object.keys(this.commits).reduce((p, i) => {
                    p[i] = true;
                    return p;
                }, {});
                let theirs = data.data.reduce((p, i) => {
                    p[i] = true;
                    return p
                }, {});
                let toRequest = [];
                for (let i in theirs) {
                    if (!ourCopyTheirs[i]) {
                        toRequest.push(i);
                    }
                }
                this.sendToRemote(remoteID, { type: "requestCommits", data: toRequest, doneCallbackID: data.doneCallbackID });
                break;
            case "requestCommits":
                this.sendToRemote(remoteID, { type: "sendCommits", data: data.data.map(i => this.commits[i]), doneCallbackID: data.doneCallbackID });
                break;
            case "sendCommits":
                let itemsWeDontHave = [];
                // figure out what items we don't have yet
                data.data.forEach(i => {
                    for (let itemID in i.items) {
                        if (!this.itemChunks[itemID][i.items[itemID]]) {
                            itemsWeDontHave.push([itemID, i.items[itemID]]);
                        }
                    }
                    // save the commits to disk
                    console.log(`enrolling commit from sendcommit: ${i.timestamp}, which is in commits? ${i.timestamp in this.commits}`);
                    this.enrolCommit(i);
                });
                // ask for the items we don't have
                this.sendToRemote(remoteID, { type: "requestItems", data: itemsWeDontHave, doneCallbackID: data.doneCallbackID });
                break;
            case "requestItems":
                //send over the desired items
                let thingsToSend = data.data.map(i => {
                    if (!this.itemChunks[i[0]][i[1]]) {
                        console.log(`ERR: ${remoteID}/${docID} requested missing item ${i[0]}::${i[1]}`);
                    } else {
                        return [i[0], this.itemChunks[i[0]][i[1]]];
                    }
                });
                console.log(`${remoteID}/${docID} Total item requests: ${thingsToSend.length}`);
                this.sendToRemote(remoteID, {
                    type: "recieveItems",
                    data: thingsToSend,
                    doneCallbackID: data.doneCallbackID
                });
                break;
            case "recieveItems":
                data.data.forEach(i => {
                    this.checkEnrolItem(i[0], i[1]);
                });
                // merge
                let headCommit = this.getLatestCommitFrom(thisServerIdentifier);
                let remoteCommit = this.getLatestCommitFrom(remoteID);
                // expand the commits
                let inflatedHeadCommit = this.getInflatedCommit(headCommit);
                let inflatedRemoteCommit = this.getInflatedCommit(remoteCommit);
                // compare the commits
                console.log(`headcommit had n keys: ${Object.keys(inflatedHeadCommit.items).length}`);
                console.log(`t of heacommit is: ${headCommit.timestamp}`);
                console.log(`t of infla heacommit is: ${inflatedHeadCommit.timestamp}`);
                let mutableCopyLatestCommit = {
                    source: thisServerIdentifier,
                    timestamp: Date.now(),
                    items: JSON.parse(JSON.stringify(inflatedHeadCommit.items)),
                };
                for (let i in inflatedRemoteCommit.items) {
                    if (!inflatedRemoteCommit.items[i]) {
                        console.log(`WARNING: UNDEF ITEM ${i}`);
                        continue;
                    }
                    if (!inflatedHeadCommit.items[i] || inflatedHeadCommit.items[i] < inflatedRemoteCommit.items[i]) {
                        //console.log(`${docID} updating ${i} from ${remoteID} (lc:${inflatedHeadCommit.items[i]} vs rm:${inflatedRemoteCommit.items[i]})`);
                        mutableCopyLatestCommit.items[i] = remoteCommit.items[i];
                    }
                }
                // compress the commit

                mutableCopyLatestCommit = this.compressCommit(mutableCopyLatestCommit);
                // enrol the commit
                this.enrolCommit(mutableCopyLatestCommit);
                console.log(`mutable had n keys: ${Object.keys(mutableCopyLatestCommit.items).length}`);
                console.log(`t of mutable is: ${mutableCopyLatestCommit.timestamp}`);
                if (data.doneCallbackID) {
                    pullRequestCompletionCallbacks[data.doneCallbackID]();
                }
                // fetch the latest commit from the source we just potatoed
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
                console.log("finished pulling from remote");
                res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
            }
        });

        nng = new nanogram(thisServerIdentifier, {
            udpPort: 12482,
            callWord: "nanogram_gitlite"
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
                    //console.log(data.op, client.id);
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
                console.log("error closed " + client.id + " ," + e);
                await nng.connectTo(client.id);
            })
            client.connection.on("close", async(e) => {
                delete onlineClients[client.id];
                console.log("close closed " + client.id + " ," + e);
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