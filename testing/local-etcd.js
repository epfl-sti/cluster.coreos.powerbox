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

var localEtcds = [];

var LocalEtcd = exports.LocalEtcd = function () {
    localEtcds.push(this);
};

LocalEtcd.killAll = function () {
    return Promise.all(localEtcds.map(function (etcd) {
        return etcd.stop();
    }));
};

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
                '--name', 'local-etcd', '--rm', 'quay.io/coreos/etcd:v2.0.12',
                '-name', 'etcd0',
                '-listen-client-urls', 'http://0.0.0.0:2379',
                '-advertise-client-urls', translatedClientAddress,
                '-listen-peer-urls',  'http://0.0.0.0:2380',
                '-initial-advertise-peer-urls', translatedPeerAddress,
                '-initial-cluster', 'etcd0=' + translatedPeerAddress,

                '-initial-cluster-token', uniqueName,
                '-initial-cluster-state', 'new'
            ]);
            debug("dockerArgs is ", dockerArgs);
        self.process = child_process.spawn(
            self.dockerCommand(), dockerArgs,
                {stdio: ['ignore', 'inherit', 'inherit'],
                    env: self.dockerEnv()}
            );
        return new Promise(function (resolve, reject) {
            self.process.on("error", reject);
            self.process.on("exit", function () {
                reject(new Error("docker exited prematurely"));
            });
            // TODO: check that etcd became a leader
            // using "docker logs local-etcd"
            setTimeout(function () {
                debug("Pinging etcd root");
                self.getClient().get("/", function(err, n) {
                    if (err) {
                        reject(err);
                    } else if (n && n.node && n.node.dir) {
                        resolve();
                    } else {
                        reject(new Error("Weird root node"));
                    }
                });

            }, 10 * 1000);
        });
    });
};

LocalEtcd.prototype.stop = function () {
    var self = this;
    if (! self.process) return Promise.resolve();
    return new Promise(function (resolve, reject) {
        self.process.kill();
        var timeout = setTimeout(function () {
            reject(new Error("Timed out trying to stop local etcd"));
        }, 10000);
        self.process.once("exit", function () {
            clearTimeout(timeout);
            resolve();
        });
    });
};

LocalEtcd.prototype.writeTestKeys = function (keys) {
    var client = this.getClient();
    return Promise.all(keys.map(function (kv) {
        var k = kv[0];
        var v = kv[1];
        return new Promise(function (resolve, reject) {
            client.set(k, v, function (err, unused_node) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            })
        })
    }));
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
    if (this.isKitematic()) {
        return ("/Applications/Kitematic (Beta).app/Contents/Resources/resources/docker");
    } else {
        throw new Error("Failed at guessing docker path!");
    }
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

