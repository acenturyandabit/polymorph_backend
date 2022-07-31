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
let pmDataUtils = require("./polymorph_dataUtils");


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

let getLogTrueSize = (chunkLog) => {
    let size = 0;
    chunkLog.forEach(i => size += Object.keys(i).length);
    return size;
}

function FileManager(docID, basepath, fileOptions) {
    this.docID = docID;
    this.basepath = basepath;
    let commitsPath = `${basepath}/commits`; // commits
    let passwordPath = `${basepath}/password.txt`; // commits
    /*
    File structure
    /commits
        /baseFile-<unixtime>.json
        /log-<unixtime>.json
        /password.txt
        Live structure: 
    chunks:{
        <unixtime>:{
            baseFile:{item:{value}}
            log:[{delta wholechunk},]
        }
        // lazy
    }
    */

    // private vars
    let password = "";
    let chunks = {};
    let fileList = {};
    if (!fileOptions) fileOptions = {};

    // Create file structure if it does not exist
    if (!fs.existsSync(basepath)) {
        fs.mkdirSync(basepath);
    }
    if (!fs.existsSync(commitsPath)) {
        fs.mkdirSync(commitsPath);
        console.log("no commits path, making it.");
        // Create password if it does not exist
        console.log(fileOptions);
        fs.writeFileSync(passwordPath, fileOptions.password);
    }
    if (fs.existsSync(passwordPath)) password = String(fs.readFileSync(passwordPath));


    // Get latest latest file
    for (let commit of fs.readdirSync(commitsPath)) {
        if (commit.endsWith(".json")) {
            // split by dash and add it to the list of files
            try {
                fileList[Number(commit.split("-")[1].split(".")[0])] = true;
            } catch (e) {
                console.log("Invalid file " + commit);
            }
        }
    };
    fileList = Object.keys(fileList);
    fileList.sort((a, b) => b - a);
    let latestFile = fileList[0];
    // If there is no latest file, then write a new file
    if (fileList.length == 0) {
        latestFile = 0;
        chunks[latestFile] = {
            baseFile: {},
            log: []
        };
        fs.writeFileSync(`${commitsPath}/baseFile-${latestFile}.json`, "{}");
    }
    console.log(`${docID} monoGitlite Files read:${fileList}`);


    let getVersion = (vID) => {
        let file = Math.floor((vID / 1000)); // slice off last 3 to get the date
        let logRow = (vID % 1000);
        if (!chunks[file]) {
            if (fs.existsSync(`${commitsPath}/baseFile-${file}.json`)) {
                chunks[file] = {
                    baseFile: JSON.parse(String(fs.readFileSync(`${commitsPath}/baseFile-${file}.json`))),
                    log: (String(fs.readFileSync(`${commitsPath}/log-${file}.json`)).split("\n").filter(i => i)).map(i => JSON.parse(i))
                }
            } else {
                console.log(`Failed on nonexistent file ${file}, vid was ${vID}`);
                let lastFile = Object.keys(chunks).sort((a, b) => b - a)[0];
                let baseFile = Object.assign({}, chunks[lastFile].baseFile);
                chunks[lastFile].log.forEach(i => {
                    Object.assign(baseFile, i);
                })
                chunks[file] = {
                    baseFile: baseFile,
                    log: []
                };
                // write 
                fs.writeFileSync(`${commitsPath}/baseFile-${file}.json`, JSON.stringify(baseFile));
                fs.writeFileSync(`${commitsPath}/log-${file}.json`, ""); // touch to exist
            }
        }
        let result = Object.assign({}, chunks[file].baseFile);
        for (let i = 0; i < logRow; i++) {
            Object.assign(result, chunks[file].log[i]);
        }
        return result;
    }

    let getLatestVersion = () => {
        if (!chunks[latestFile]) {
            chunks[latestFile] = {};
            try {
                chunks[latestFile].baseFile = JSON.parse(String(fs.readFileSync(`${commitsPath}/baseFile-${latestFile}.json`)));
            } catch (e) {
                // TODO: recompile basefile from previous commit
                chunks[latestFile].baseFile = {};
            }
            try {
                chunks[latestFile].log = (String(fs.readFileSync(`${commitsPath}/log-${latestFile}.json`)).split("\n")).filter(i => i).map(i => JSON.parse(i))
            } catch (e) {
                // TODO: recompile basefile from previous commit
                chunks[latestFile].log = [];
            }
        }
        return getVersion(latestFile * 1000 + chunks[latestFile].log.length);
    }

    /*
    Item structure
    slowly appended to the commit files
    only latest version is used: save disk space, increase cost of finding items in future.
    */

    /*==========================Client management=================================*/
    //Called by the client to save a document
    this.processClientIncoming = (doc) => {
        /*
        doc:{
            commit: <vID>
            items: {item:{}},
            password: <password>
        }
        */
        if (password && doc.password != password) {
            console.log("bad password attempt on " + docID + ": " + doc.password);
            return {
                err: "password mismatch"
            }
        }

        //// Update local storage
        // filter out duplicate diffs. 
        let currentVersion = getLatestVersion();
        for (let i in doc.items) {
            if (currentVersion[i] && currentVersion[i]._lu_ > doc.items[i]._lu_) {
                delete doc.items[i];
            } else {
                currentVersion[i] = doc.items[i];
            }
        }
        // append diff to latest file
        // if more than 1000 diffs, then restart
        chunks[latestFile].log.push(doc.items);
        fs.appendFileSync(`${commitsPath}/log-${latestFile}.json`, JSON.stringify(doc.items) + "\n");
        if (getLogTrueSize(chunks[latestFile].log) > 999) {
            console.log("ok im splitting the version");
            latestFile = Date.now();
            // latestfile wont exist so create it
            chunks[latestFile] = {};
            chunks[latestFile].baseFile = currentVersion;
            chunks[latestFile].log = [];
            fs.writeFileSync(`${commitsPath}/baseFile-${latestFile}.json`, JSON.stringify(currentVersion));
        }

        // Report new diffs
        let oldVersion = getVersion(doc.commit);
        let changesToSend = {};
        for (let i in currentVersion) {
            if (!oldVersion[i] || currentVersion[i]._lu_ > oldVersion[i]._lu_) {
                changesToSend[i] = currentVersion[i];
            }
        }

        return {
            commit: latestFile * 1000 + chunks[latestFile].log.length,
            items: changesToSend
        };
    }

    this.collateForClient = (options) => {
        if (!(password && options.password != password)) {
            return {
                items: polymorph_core.datautils.IDCompress.compress(getLatestVersion()),
                commit: latestFile * 1000 + chunks[latestFile].log.length
            };
        } else {
            return {
                err: "password mismatch"
            }
        }
    }
}


module.exports = {
    prepare: async (app, private) => {
        console.log("Loaded monogit");
        let availList = {};

        // Cache of initial files to make searching FS-independent after first load
        // Added bonus of increased security for fs-exists
        let initialFSList = {};

        //do an FS sweep
        await (new Promise((res, rej) => {
            //populate local lobby
            fs.readdir(private.baseMonoGitLocation, { withFileTypes: true }, (err, files) => {
                if (err) {
                    if (err.code == "ENOENT") {
                        fs.mkdirSync(private.baseMonoGitLocation, { recursive: true });
                    } else {
                        console.log(err);
                    }
                } else {
                    for (let f of files) {
                        if (f.isDirectory()) {
                            initialFSList[f.name] = true;
                        }
                    }
                }
                res();
            });
        }));



        // respond to lobby requests
        if (private.allowUserCreate) {
            app.get("/monoglobby", async (req, res) => {
                res.send(JSON.stringify(Object.values(availList).map(i => i.id)));
            });
        }

        // respond to save requests
        app.post("/monogitsave", async (req, res) => {
            console.log("Got save request at " + Date.now() + "for " + req.query.f);
            // Check if there is a handler for it; if handler exists, implies directory exists.
            if (!availList[req.query.f]) {
                // Check if directory has been allocated for it; if not, don't allow if users arent allowed to create docs
                // Creating the directory will be handled downstream
                if (!private.allowUserCreate && !initialFSList[req.query.f]) {
                    res.status(400).end();
                    return;
                } else {
                    availList[req.query.f] = {
                        id: req.query.f,
                        fileManager: new FileManager(req.query.f, private.baseMonoGitLocation + "/" + req.query.f, JSON.parse(req.body)) //lazy load
                    };
                }
            }

            // Recieve the updates
            // we're not using json because cors
            let result = availList[req.query.f].fileManager.processClientIncoming(JSON.parse(req.body), thisServerIdentifier);
            res.status(200).send(JSON.stringify(result));
        });

        app.post("/monogitload", async (req, res) => {
            // Check if there is a handler for it; if handler exists, implies directory exists.
            if (!availList[req.query.f]) {
                // Check if directory has been allocated for it; if not, it doesn't exist.
                if (initialFSList[req.query.f]) {
                    availList[req.query.f] = {
                        id: req.query.f,
                        fileManager: new FileManager(req.query.f, private.baseMonoGitLocation + "/" + req.query.f)
                    };
                } else {
                    // document does not exist, probably bc user added savesource but made no changes and didnt save
                    // or it just isn't there
                    // return the default document
                    res.send(JSON.stringify({ commit: 0, doc: defaultBaseDocument(req.query.f) }));
                    return;
                }
            }
            res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient(JSON.parse(req.body))));
        });
    },
    FileManager: FileManager
}