var child_process = require('child_process'),
    debug = require('debug')('local-etcd'),
    fs = require('fs'),
    portfinder = require('portfinder'),
    EtcdClient = require('node-etcd');

// https://coreos.com/etcd/docs/latest/docker_guide.html

function promisePort() {
    return new Promise(function(resolve, reject) {
        portfinder.getPort(function (err, port) {
            if (err) {
                reject(err);
            } else {
                resolve(port);
            }
        })
    });
}

function caCertsDir() {
    var caCertsDir = undefined;
    ["/usr/share/ca-certificates"].forEach(function(dir) {
        if (fs.existsSync(dir)) {
            caCertsDir = dir;
        }
    });
    return caCertsDir;
}

/**
 * Run a local etcd in Docker
 *
 * @constructor
 */

var LocalEtcd = exports.LocalEtcd = function () {};

LocalEtcd.prototype.start = function () {
    var self = this;
    if (self.process) return Promise.resolve();
    var maybeCaCertsMount = [];
    var certsDir = caCertsDir();
    if (certsDir) {
        maybeCaCertsMount = ['-v', certsDir];
    }
    var ip = self.dockerIpAddress();

    var myPromise = Promise.resolve();
    if (!(self.clientPort && self.peerPort)) {
        myPromise = myPromise.then(function () {
            return Promise.all([promisePort(),
                                promisePort()]);
        }).then(function (ports) {
            self.peerPort = ports.pop();
            self.clientPort = ports.pop();
        });
    }

    return myPromise.then(function () {
        var uniqueName = 'local-etcd-' + (new Date().getTime());
        var translatedPeerAddress = 'http://' + ip + ':' + String(self.peerPort);
        var translatedClientAddress = 'http://' + ip + ':' + String(self.clientPort);
        var dockerArgs =             Array.prototype.concat(
            ['run'],
            maybeCaCertsMount,
            //
            [
                '-p', String(self.clientPort) + ':2379',
                '-p', String(self.peerPort) + ':2380',
                '--name', uniqueName, 'quay.io/coreos/etcd:v2.0.12',
                '-name', 'etcd0',
                '-advertise-client-urls', translatedClientAddress,
      //          '-listen-client-urls', 'http://0.0.0.0:' + String(self.clientPort),
                '-initial-advertise-peer-urls', translatedPeerAddress,
                '-initial-cluster', 'etcd0=' + translatedPeerAddress,
        //        '-listen-peer-urls',  'http://0.0.0.0:2380',

                '-initial-cluster-token', uniqueName,
                '-initial-cluster-state', 'new'
            ]);
            debug("dockerArgs is ", dockerArgs);
        self.process = child_process.spawn(
            self.dockerCommand(), dockerArgs,
                {stdio: 'inherit', env: self.dockerEnv()}
            );
        return new Promise(function (resolve, reject) {
            self.process.on("error", reject);
            self.process.on("exit", function () {
                reject(new Error("docker exited prematurely"));
            });
            self.getClient().get("/", function(err, n) {
                if (err) {
                    reject(err);
                } else if (n && n.node && n.node.dir) {
                    resolve();
                } else {
                    reject(new Error("Weird root node"));
                }
            });
        });
    });
};

LocalEtcd.prototype.stop = function () {
    var self = this;
    if (! self.process) return Promise.resolve();
    return new Promise(function (resolve, reject) {
        self.process.kill(process.pid);
        var timeout = setTimeout(function () {
            self.process.removeListener(resolve);
            reject(new Error("Timed out trying to stop local etcd"));
        }, 10000);
        self.process.once("exit", function () {
            clearTimeout(timeout);
            resolve();
        });
    });
};

LocalEtcd.prototype.isKitematic = function() {
    return true;
};

LocalEtcd.prototype.dockerIpAddress = function() {
    if (this.isKitematic()) {
        return this.dockerEnv().DOCKER_HOST.match(/^tcp:\/\/([0-9\.]+)(?:$|:)/)[1];
    } else {
        return '127.0.0.1';
    }
};

LocalEtcd.prototype.getClient = function () {
    return new EtcdClient(this.dockerIpAddress(), this.clientPort);
};

LocalEtcd.prototype.dockerCommand = function () {
    // TODO: portablify
    return ("/Applications/Kitematic (Beta).app/Contents/Resources/resources/docker");
};

LocalEtcd.prototype.dockerEnv = function () {
  // TODO: portablify
    var envCopy = {};
    for (e in process.env) envCopy[e] = process.env[e];
    envCopy.DOCKER_HOST = 'tcp://192.168.99.100:2376';
    envCopy.DOCKER_TLS_VERIFY = 1;
    envCopy.DOCKER_CERT_PATH = '/Users/dom/.docker/machine/machines/dev';

    return envCopy;
};