const express = require("express");
const cors = require('cors');
const fs = require("fs");
var app = express();
var bodyParser = require('body-parser');

var private = require('./private');


app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('polymorph'));
app.listen(8080);

app.use(cors());

/*try {
    var app2 = express();
    app2.get("*", (req, res) => res.send(`<script>window.location.href="http://localhost:8080"</script>`));
    app2.listen(80);
} catch (e) {

}*/

var saveloader = require("./saveload");
saveloader.prepare(app, private);

var gitlite = require("./gitlite");
gitlite.prepare(app, private);

if (private.lobbyFileLocation) { // dont want this on the linode
    var lobby = require("./lobby");
    lobby.prepare(app, private);
}