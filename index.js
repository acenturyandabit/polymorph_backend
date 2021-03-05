const express = require("express");
const cors = require('cors');
const fs = require("fs");
var app = express();
var bodyParser = require('body-parser');

var private = require(process.argv[3] || './private');

var port = process.argv[2] || 8080;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('polymorph'));
app.listen(port);

app.use(cors());

/*try {
    var app2 = express();
    app2.get("*", (req, res) => res.send(`<script>window.location.href="http://localhost:8080"</script>`));
    app2.listen(80);
} catch (e) {

}*/

var saveloader = require("./saveload");
saveloader.prepare(app, private);

//var gitlite = require("./gitlite");
//gitlite.prepare(app, private);


if (private.imageFileLocation) { // dont want this on the linode
    var imageServer = require("./imageServer");
    imageServer.prepare(app, private);
}

if (private.lobbyFileLocation) { // dont want this on the linode
    var lobby = require("./lobby");
    lobby.prepare(app, private);
}

if (private.baseGitLocation) { // dont want this on the linode
    var lobby = require("./gitlobby");
    lobby.prepare(app, private);
}