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
        return self.runDockerCommandThenWait(Array.prototype.concat(
            ['run'],
            maybeCaCertsMount,
            //
            [
                '-d', '--name', self.containerName(),
                '-p', String(self.clientPort) + ':2379',
                '-p', String(self.peerPort) + ':2380',
                'quay.io/coreos/etcd:v2.0.12',
                '-name', 'etcd0',
                '-listen-client-urls', 'http://0.0.0.0:2379',
                '-advertise-client-urls', translatedClientAddress,
                '-listen-peer-urls', 'http://0.0.0.0:2380',
                '-initial-advertise-peer-urls', translatedPeerAddress,
                '-initial-cluster', 'etcd0=' + translatedPeerAddress,

                '-initial-cluster-token', uniqueName,
                '-initial-cluster-state', 'new'
            ]));
    }).then(function (stdoutAndStderr) {
        var stdoutBuf = stdoutAndStderr[0], stderrBuf = stdoutAndStderr[1];
        process.stderr.write(stderrBuf);
        var matched = String(stdoutBuf).match('^([a-f0-9]{64})\n$');
        if (matched) {
            self.dockerId = matched[1];
            debug("Docker " + self.dockerId + " started");
        } else {
            process.stderr.write(stdoutBuf);
            throw new Error("Unable to start etcd in Docker");
        }
    }).then(function() {
        return new Promise(function (resolve, reject) {
            var logTail = self.runDocker(["logs", "-f", self.dockerId],
                { stdio: ['ignore', process.stdout, 'pipe'] });
            logTail.on("error", reject);
            logTail.on("exit", function () {
                reject(new Error("docker log -f exited prematurely"));
            });
            logTail.stderr.on("data", function (data) {
                var text = String(data).trimRight();
                debug(text);
                if (text.match('became leader')) {
                    logTail.kill();
                    logTail.removeAllListeners("exit").on("exit", resolve);
                }
            });
        });
    }).then(function() {
        return new Promise(function (resolve, reject) {
            debug("Pinging etcd root");
            self.getClient().get("/", function(err, n) {
                if (err) {
                    reject(err);
                } else if (n && n.node && n.node.dir) {
                    resolve();
                } else {
                    debug("Weird root node: ", n);
                    reject(new Error("Weird root node"));
                }
            });
        });
    });
};

LocalEtcd.prototype.stop = function () {
    var self = this;
    if (! self.dockerId) return Promise.resolve();
    return self.runDockerCommandThenWait(["rm", "-f", self.dockerId]);
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

LocalEtcd.prototype.containerName = function () { return 'local-etcd'; };

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

/**
 * Run a Docker command
 *
 * @param dockerArgs Array of flags and arguments
 * @returns {Promise} An [stdoutBuf, stderrBuf, process] array
 */
LocalEtcd.prototype.runDockerCommandThenWait = function (dockerArgs) {
    var self = this;
    return new Promise(function (resolve, reject) {
        var process = self.runDocker(dockerArgs,
            {stdio: ['ignore', 'pipe', 'pipe']});
        var stdoutBufs = [], stderrBufs = [];
        var todo={stdoutClosed: true, stderrClosed: true, processExited: true};
        function taskDone(feature) {
            delete todo[feature];
            for(var v in todo) return;  // return if any to-do items remain
            resolve([Buffer.concat(stdoutBufs), Buffer.concat(stderrBufs),
                     process])
        }
        process.on("error", reject);

        process.on("exit", function () {
            taskDone("processExited");
        });
        process.stdout.on("data", function (data) {
            stdoutBufs.push(data);
        });
        process.stdout.on("end", function () {
            taskDone("stdoutClosed");
        });
        process.stderr.on("data", function (data) {
            stderrBufs.push(data);
        });
        process.stderr.on("end", function () {
            taskDone("stderrClosed");
        });
    });
};

LocalEtcd.prototype.runDocker = function (dockerArgs, opt_options) {
    var dockerCommand = this.dockerCommand();

    if (! opt_options) opt_options = {};
    if (! opt_options.env) opt_options.env = this.dockerEnv();

    debug("Running " +
        Array.prototype.concat([dockerCommand], dockerArgs).join(' '));
    return child_process.spawn(dockerCommand, dockerArgs, opt_options);
};

child_process.execSync("'" + LocalEtcd.prototype.dockerCommand() +
    "' rm -f local-etcd 2>/dev/null || true");
