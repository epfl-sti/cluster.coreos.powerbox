/**
 * Mirror an etcd directory into a directory on the filesystem.
 */
var fs = require("fs");

exports.forTestsOnly = {};

/**
 * Ancillary class to represent the state of the mirror target
 *
 * @param path Path to the main directory (need not exist)
 * @constructor
 */
var DirectoryState = exports.forTestsOnly.DirectoryState = function (path) {
    return {
        /**
         * @returns {Promise} A list of all file names (not directories)
         */
        load: function () {
            return new Promise(function (resolve, reject) {

            });
        },

        /**
         * Write a file, creating parent directories if needed
         * @param path
         * @param contents
         * @returns {Promise}
         */
        set: function (path, contents) {
            return new Promise(function (resolve, reject) {
            });
        },
        /**
         * Delete a file, removing parent directories if needed
         *
         * Does nothing if file doesn't exist
         *
         * @param path
         * @returns {Promise}
         */
        delete: function (path) {
            return new Promise(function (resolve, reject) {
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

