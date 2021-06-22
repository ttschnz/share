const yargs = require("yargs"),
    fs = require("fs"),
    connect = require('connect'),
    http = require('http'),
    vhost = require("vhost"),
    mime = require('mime'),
    os = require('os'),
    qr = require("qrcode"),
    path = require("path"),
    languageEncoding = require("detect-file-encoding-and-language"),
    querystring = require("querystring"),
    nodeStatic = require("node-static"),
    archiver = require('archiver');

class ShareServer {
    constructor(options) {
        this.options = options;
        this.shareFile = options.file;
        this.shareFolder = options.folder;

        this.readyState = 0;
        this.onreadystatechange = this.startServer;

        this.sharedObject = options.sharedObject;

        this.codeDir = options.codeDir;
    }
    archiveFolder(){
        
    }
    prepeareStaticFiles() {
        this.staticFileServer = new(nodeStatic.Server)(this.sharedObject);
    }
    onreadystatechange() {

    }
    set readyState(value) {
        this._readyState = value;
        this.onreadystatechange();
    }
    get readyState() {
        return this._readyState;
    }
    set sharedObject(value) {
        return new Promise((resolve, reject) => {
            value = fs.realpathSync(value);
            this.fileExists(value).then(exists => {
                if (exists) {
                    this._sharedObject = value;
                    this.readyState = 1;
                    resolve(true);
                    this.prepeareStaticFiles();

                } else {
                    throw "file or folder does not exist";
                }
            })
        });

        //        else throw `file or folder does not exist: ${value}`;
    }
    get sharedObject() {
        return this._sharedObject;
    }

    portInUse(port) {
        return new Promise((resolve, reject) => {
            var server = http.createServer(socket => {
                socket.write('Echo server\r\n');
                socket.pipe(socket);
            });

            server.on('error', e => {
                resolve(true);
            });

            server.on('listening', e => {
                server.close();
                console.log(`port ${port} is free`);
                resolve(false);
            });
            try {
                server.listen(port);
            } catch (e) {
                resolve(true);
            }
        });
    }

    fileExists(fileName) {
        return new Promise((resolve, reject) => {
            fs.access(fileName, 1, (err) => {
                if (err) resolve(false);
                else resolve(true);
            });
        })
    }

    getMimeType(fileName) {
        return mime.getType(fs.realpathSync(fileName));
    }

    getFileSize(fileName) {
        return fs.statSync(fileName).size;
    }
    isFile(fileName) {
        return fs.statSync(fileName).isFile()
    }
    isDirectory(pathName) {
        return fs.statSync(pathName).isDirectory();
    }

    async findFreePort() {
        this.port = 80;
        while (await this.portInUse(this.port)) {
            this.port = (this.port == 80) ? 49152 : this.port + 1;
        }
        return this.port;
    }

    isInSharedObject(fileName) {
        let path = fs.realpathSync(fileName);
        return (path.indexOf(this.sharedObject) === 0);
    }
    async passFile(req, res, path) {
        let fd;
        console.log(req.statusMessage);
        try {
            fd = fs.openSync(path, "r");
        } catch (e) {
            res.statusCode = 500;
            res.write("Internal Server Error");
            res.end();
            console.log(`failed to open file`);
            return;
        }

        let fileSize = Math.min(this.getFileSize(path), Infinity); // if you'd like to limit max content sent
        let offset = 0;
        let bufferSize = Math.min(200 * 1000, fileSize); // max 200kb per buffer
        let encoding;
        try {
            encoding = (await languageEncoding(path)).encoding.toLowerCase();
        } catch (e) {}
        res.setHeader("Content-Type", this.getMimeType(path) + (encoding ? `, encoding=${encoding}` : ""));
        res.setHeader("Content-Length", fileSize);
        res.statusCode = 200;

        while (offset < fileSize) {
            //            console.log(offset, bufferSize, fileSize);
            let buffer = Buffer.alloc(bufferSize);
            fs.readSync(fd, buffer, 0, bufferSize, 0);
            res.write(buffer);
            offset += bufferSize;
            bufferSize = Math.min(bufferSize, fileSize - offset);
        }
        res.end();


        //        fs.readFile(path, async (err, data) => {
        //            let mimeType = mime.getType(path);
        //            if (err) {
        //                res.statusCode = 500;
        //                res.write("Internal Server Error");
        //                res.end();
        //                console.log(`failed to read file: ${err}`);
        //            } else {
        //
        //                res.setHeader("Content-Type", this.getMimeType(path) + ", charset=" + (await languageEncoding(path)).encoding.toLowerCase());
        //                res.setHeader("Content-Length", this.getFileSize(path));
        //                res.statusCode = 200;
        //                res.write(data);
        //                res.end();
        //            }
        //        });
    }
    listDirectory(req, res, path) {
        res.statusCode = 200;
        let html = fs.readFileSync(this.codeDir + "\\dirlist.html", "utf8");
        let dirlist = fs.readdirSync(path, {
            withFileTypes: true
        });
        let processedDirList = [];

        for (let i of dirlist) {

            processedDirList.push({
                name: i.name,
                isFile: i.isFile(),
                isDirectory: i.isDirectory(),
                isSymbolicLink: i.isSymbolicLink(),
                mimeType: this.getMimeType(path + "\\" + i.name)
            });
        }
        res.write(html.replace("__DIRLIST", JSON.stringify(processedDirList)));
        res.end();

    }

    async handleRequest(req, res) {
        if (this.shareFile) {
            if (req.url !== "/") {
                res.writeHead(301, {
                    'Location': '/'
                });
                res.end();
            } else {
                this.staticFileServer.serve(req, res);
            }
            //            this.passFile(req, res, this.sharedObject)
        } else if (this.shareFolder) {
            try {
                let requestedObject = fs.realpathSync(this.sharedObject + querystring.unescape(req.url));
                console.log(requestedObject);
                let allowed = this.isInSharedObject(requestedObject);
                if (!allowed) {
                    res.statusCode = 403;
                    res.write("Forbidden");
                    res.end();
                } else {
                    if (this.isFile(requestedObject)) this.staticFileServer.serve(req, res);
                    else if (this.isDirectory(requestedObject)) this.listDirectory(req, res, requestedObject);
                    else throw "Not Found";

                }
            } catch (e) {
                console.warn(e);
                res.statusCode = 404;
                res.write("Not found");
                res.end();
            }
        }
    }

    async startServer() {
        console.log(`prepearing to share ${this.sharedObject}`);
        this.app = connect();
        this.app.use(vhost(new RegExp(".*"), this.handleRequest.bind(this)));
        this.server = http.createServer(this.app);
        await this.findFreePort();
        try {
            this.server.listen(this.port);
        } catch (e) {
            console.log(`could not start on port ${this.port}`);
        }
        this.server.on("listening", this.displayQR.bind(this))
    }
    displayQR() {
        console.log(`server running on port ${this.port}`);

        // filter ip addresses
        var interfaces = os.networkInterfaces();
        var addresses = [];
        for (var k in interfaces) {
            for (var k2 in interfaces[k]) {
                var address = interfaces[k][k2];
                if (address.family === 'IPv4' && !address.internal && k.toLowerCase().indexOf("virtual") == -1) {
                    addresses.push(address.address);
                }
            }
        }

        let serverAddress = `http://${addresses[0]}:${this.port}/`;
        console.log(serverAddress);
        qr.toString(serverAddress, function (error, data) {
            if (error) {
                throw new Error(error)
            }
            console.log(data);
        });
    }
}

let codeDir = path.dirname(process.argv[1]);
let dummyFile = path.dirname(process.argv[1]) + "\\dummyfile.txt";
let arguments = yargs.parse(process.argv.slice(2));

let isFile = !!arguments.file,
    isFolder = !!arguments.folder,
    pathName = arguments.file ?? arguments.folder ?? dummyFile;

isFile = pathName == dummyFile ? true : isFile;
console.log(pathName);
try {
    const shareServer = new ShareServer({
        sharedObject: pathName,
        file: isFile,
        folder: isFolder,
        codeDir: codeDir
    });
} catch (e) {
    console.log("error sharing file or folder:", e);
}

(async () => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(true);
        }, 10000);
    });
})();
