let path = require("path");
let fs = require("fs");
module.exports = {
    prepare: (app, private) => {
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
                            } else {
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
    }
}