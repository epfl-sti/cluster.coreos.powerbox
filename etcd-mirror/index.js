/**
 * Mirror an etcd directory into a directory on the filesystem.
 */
var fs = require("fs"),
    path = require("path"),
    util = require("util"),
    aWrite = require("atomic-write"),
    debug = require("debug")("etcd-mirror"),
    mkpath = require("mkpath"),
    Q = require("q"),
    EventEmitter = require("events").EventEmitter;

exports.forTestsOnly = {};

// From https://github.com/coreos/etcd/blob/master/Documentation/errorcode.md
// Should be in node-etcd I suppose (but I don't speak CoffeeScript yet)
var EcodeKeyNotFound = 100;

/**
 * Ancillary class to represent the state of the mirror target
 *
 * @param sie Path to the main directory (need not exist)
 * @constructor
 */
var DirectoryState = exports.forTestsOnly.DirectoryState = function (dir) {
    dir = path.resolve(dir);
    return {
        /**
         * Write a file, creating parent directories if needed
         * @param keyPath
         * @param contents
         * @returns {Promise}
         */
        set: function (keyPath, contents) {
            var fullPath = dir + "/" + keyPath;
            return Q.nfcall(mkpath, path.dirname(fullPath))
                .then(function () {
                    return Q.nfcall(aWrite.writeFile.bind(aWrite),
                        fullPath, contents);
                });
        },
        /**
         * Delete a file, removing parent directories if needed
         *
         * Does nothing if file doesn't exist
         *
         * @param keyPath
         * @returns {Promise}
         */
        delete: function (keyPath) {
            var fullPath = dir + "/" + keyPath;
            return Q.nfcall(fs.unlink, fullPath)
                .catch(function (error) {
                    if (error.code === "ENOENT") return;
                    throw error;
                });
        }
    }
};

/**
 * Flush all data in an etcd node into the filesystem.
 * @param node A node object as returned by node-etcd
 * @param dirState An instance of DirectoryState
 * @returns {Promise} Resolves when done writing
 */
function nodeToDirState(node, dirState, fromEtcdSubdir) {
    var doneWritingPromises = [];
    var addNodeRecursively;
    addNodeRecursively = function (node) {
        if (node.nodes) {
            node.nodes.map(addNodeRecursively);
        }
        if (node.value) {
            var relPath = path.relative(fromEtcdSubdir, node.key);
            if (! relPath.startsWith("../")) {
                doneWritingPromises.push(dirState.set(
                    "/" + relPath, node.value));
            }
        }
    };
    addNodeRecursively(node);
    return Promise.all(doneWritingPromises);
}

function getNodeMaxIndex(node) {
    return Math.max.apply(null, Array.prototype.concat(
        [node.modifiedIndex, node.createdIndex],
        (node.nodes || []).map(getNodeMaxIndex)));
}

/**
 * Keep a path in sync with a subdirectory of etcd, recursively
 *
 * @param client A [node-etcd](https://www.npmjs.com/package/node-etcd) instance
 * @param fromEtcdSubdir The subdirectory to watch inside the etcd object
 * @param toDir The path to mirror to, or injected DirectoryState object (for tests)
 * @constructor
 */
exports.EtcdMirror = function (client, fromEtcdSubdir, toDir) {
    var dirState = (toDir instanceof String) ? new DirectoryState(toDir) : toDir;
    fromEtcdSubdir = path.resolve("/", fromEtcdSubdir);
    var self = this, stopped, lastIndex;

    /**
     * Load the current etcd state from a recursive get, and write it out.
     *
     * @returns {Promise}
     */
    var sync = function () {
        var syncedNode;
        return new Promise(function (resolve, reject) {
            client.get(fromEtcdSubdir, {recursive: true}, function (err, result) {
                if (err) {
                    if (err.errorCode !== EcodeKeyNotFound) return reject(err);
                } else {
                    syncedNode = result.node;
                }
                resolve();
            })
        }).then(function () {
                if (stopped) return;
                if (! syncedNode) return;  // Directory doesn't exist yet
                return nodeToDirState(syncedNode, dirState, fromEtcdSubdir);
            }).then(function () {
                if (syncedNode) lastIndex = getNodeMaxIndex(syncedNode);
                debug("Synced at index", lastIndex);
            });
    };

    var listenToChanges;
    /**
     * Start syncing
     *
     * Emits:
     *   'sync' - Initial sync done, all writes complete
     *   'change' - A subsequent change was done, all writes complete
     *   'error' - Something went wrong, the sync was stopped
     */
    this.start = function() {
        stopped = false;
        sync().then(function () {
            if (stopped) return;
            self.emit("sync");
            listenToChanges();
        }).catch(function(error) {
            self.emit("error", error);
        });
    };

    /**
     * Stop syncing
     */
    this.stop = function() {
        stopped = true;
    };

    listenToChanges = function () {
        if (stopped) return;
        var nextIndex = (lastIndex === undefined) ? undefined : lastIndex + 1;
        debug("Listening to changes at index", nextIndex);
        var watcher = client.watcher(fromEtcdSubdir, nextIndex,
            {recursive: true});
        watcher.on("error", function (error) {
            self.emit("error", error);
        });
        watcher.once("change", function (result) {
            debug("watcher change event");
            // Throttle flow to prevent silly write races with ourselves
            watcher.stop();
            nodeToDirState(result.node, dirState, fromEtcdSubdir)
                .then(function () {
                    lastIndex = getNodeMaxIndex(result.node);
                    self.emit("change", lastIndex);
                    debug("Resuming flow at index", lastIndex);
                    listenToChanges();   // Resume flow
                }).catch(function (error) {
                    debug("Error in listenToChanges:", error);
                    self.emit("error", error);
                });
        });
    };
};

util.inherits(exports.EtcdMirror, EventEmitter);
