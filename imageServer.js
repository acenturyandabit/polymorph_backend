var fs = require("fs");
var bp = require("body-parser");
var ImageDataURI = require('image-data-uri');

module.exports = {
    prepare: (app, private) => {
        app.use(bp.raw({
            inflate: true,
            limit: '100kb',
            type: 'image/png'
        }));
        app.post("/saveImage", (req, res) => {
            let fn = Date.now();
            if (Buffer.isBuffer(req.body)) {
                ImageDataURI.outputFile(req.body.toString(), `${private.imageFileLocation}/${fn}.png`).then(() => {
                    res.send(fn.toString()).end();
                });
            } else {
                console.log("oh no");
                console.log(req.body);
                res.status(400).end();
            }
            //res.send(encodedURL);
        });
        app.get("/getImage/*", (req, res) => {
            let imageCleanName = req.url.split("/");
            imageCleanName = imageCleanName[imageCleanName.length - 1];
            imageCleanName = imageCleanName.replace(/[^\w.]/g, "_");
            if (fs.existsSync(private.imageFileLocation + "/" + imageCleanName)) {
                res.sendFile(private.imageFileLocation + "/" + imageCleanName);
            } else {
                res.status(400).end();
            }
        })
    }
}