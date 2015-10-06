/**
 * Mirror an etcd directory into a directory on the filesystem.
 */
var fs = require("fs"),
    path = require("path"),
    aWrite = require("atomic-write"),
    mkpath = require("mkpath"),
    Q = require("q");

exports.forTestsOnly = {};

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
 * Keep a path in sync with a subdirectory of etcd, recursively
 *
 * @param client A [node-etcd](https://www.npmjs.com/package/node-etcd) instance
 * @param etcdSubdir The subdirectory to watch inside the etcd object
 * @param path The path, or injected DirectoryState object (for tests)
 * @constructor
 */
exports.EtcdMirror = function (client, etcdSubdir, path) {
    var dirState = (path instanceof String) ? new DirectoryState(path) : path;

    return {
        /**
         * Load the current etcd state from a recursive get, and write it out.
         *
         * @returns {Promise}
         */
        sync: function () {
            return new Promise(function (resolve, reject) {
                client.get("/", {recursive: true}, function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    } else {
                        resolve(result);
                    }
                })
            }).then(function (result) {
                    var addNodeRecursively;
                    var doneWritingPromises = [];
                    addNodeRecursively = function (node) {
                        if (node.nodes) {
                            node.nodes.map(addNodeRecursively);
                        }
                        if (node.value) {
                            doneWritingPromises.push(dirState.set(
                                node.key, node.value));
                        }
                    };
                    addNodeRecursively(result.node);
                    return Promise.all(doneWritingPromises);
                });
        }
    };
};

