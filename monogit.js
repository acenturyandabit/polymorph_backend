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


function FileManager(docID, basepath) {
    this.docID = docID;
    this.basepath = basepath;

    let commitsPath = `${basepath}/commits`; // commits
    /*
    File structure
    /commits
        /baseFile-<unixtime>.json
        /log-<unixtime>.json

    Live structure: 
    chunks:{
        <unixtime>:{
            baseFile:{item:{value}}
            log:[{delta wholechunk},]
        }
        // lazy
    }

    */
    let chunks = {};
    if (!fs.existsSync(basepath)) {
        fs.mkdirSync(basepath);
    }
    if (!fs.existsSync(commitsPath)) {
        fs.mkdirSync(commitsPath);
    }

    // Get latest latest file
    let fileList = [];

    for (let commit of fs.readdirSync(commitsPath)) {
        if (commit.endsWith(".json")) {
            // split by dash and add it to the list of files
            try {
                fileList.push(Number(commit.split("-")[1].split(".")[0]));
            } catch (e) {
                console.log("Invalid file " + commit);
            }
        }
    };
    fileList.sort((a, b) => b - a);
    let latestFile = fileList[0];
    if (fileList.length == 0) {
        latestFile = 0;
        chunks[latestFile] = {
            baseFile: {},
            log: []
        };
        fs.writeFileSync(`${commitsPath}/baseFile-${latestFile}.json`, "{}");
    }
    console.log(fileList);
    let getVersion = (vID) => {
        let file = (vID / 1000) | 0; // slice off last 3 to get the date
        let logRow = (vID % 1000);
        if (!chunks[file]) {
            if (fs.existsSync(`${commitsPath}/baseFile-${file}.json`)) {
                chunks[file] = {
                    baseFile: JSON.parse(String(fs.readFileSync(`${commitsPath}/baseFile-${file}.json`))),
                    log: (String(fs.readFileSync(`${commitsPath}/log-${file}.json`)).split("\n").filter(i => i)).map(i => JSON.parse(i))
                }
            } else {
                let baseFile = Object.assign({}, chunks[file - 1].baseFile);
                chunks[file - 1].log.forEach(i => {
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
        return getVersion(latestFile + chunks[latestFile].log.length);
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
            items: {item:{}}
        }
        */

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
        if (chunks[latestFile].log.length > 999) {
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

    this.collateForClient = () => {
        return {
            items: polymorph_core.datautils.IDCompress.compress(getLatestVersion()),
            commit: latestFile * 1000 + chunks[latestFile].log.length
        };
    }
}


module.exports = {
    prepare: async(app, private) => {
        console.log("Loaded monogit");
        let availList = {};
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
                            availList[f.name] = {
                                id: f.name,
                                fileManager: new FileManager(f.name, private.baseMonoGitLocation + "/" + f.name) //lazy load
                            };
                        }
                    }
                }
                res();
            });
        }));
        if (private.allowUserCreate) {
            app.get("/monoglobby", async(req, res) => {
                //get more from nanogram
                res.send(JSON.stringify(Object.values(availList).map(i => i.id)));
            });
        }

        app.post("/monogitsave", async(req, res) => {
            if (!availList[req.query.f]) {
                if (!private.allowUserCreate && !fs.existsSync(private.baseMonoGitLocation + "/" + req.query.f)) {
                    res.status(400).end();
                    return;
                }
                availList[req.query.f] = {
                    id: req.query.f,
                    fileManager: new FileManager(req.query.f, private.baseMonoGitLocation + "/" + req.query.f) //lazy load
                };
            }
            // we're not using json because cors
            let result = availList[req.query.f].fileManager.processClientIncoming(JSON.parse(req.body), thisServerIdentifier);
            res.status(200).send(JSON.stringify(result));
        });

        app.get("/monogitload", async(req, res) => {
            if (!availList[req.query.f]) {
                res.send(JSON.stringify({ commit: 0, doc: defaultBaseDocument(req.query.f) }));
                return; // document does not exist, probably bc user added savesource but made no changes and didnt save
            }
            if (!availList[req.query.f].fileManager) {
                availList[req.query.f].fileManager = new FileManager(req.query.f, private.baseMonoGitLocation + "/" + req.query.f);
            }
            res.send(JSON.stringify(availList[req.query.f].fileManager.collateForClient()));
        });
    },
    FileManager: FileManager
}