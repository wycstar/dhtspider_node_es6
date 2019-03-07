'use strict';

import net from "net";
import util from "util";
import EventEmitter from "events";
import Wire from "./wire";
import PeerQueue from "./peer-queue";

class BTClient {
    constructor(options) {
        EventEmitter.call(this);

        this.timeout = options.timeout;
        this.maxConnections = options.maxConnections || 200;
        this.activeConnections = 0;
        this.peers = new PeerQueue(this.maxConnections);
        this.on('download', this._download);

        if (typeof options.ignore === 'function') {
            this.ignore = options.ignore;
        }
    }

    ignore(infohash, rinfo, ignore) {
        ignore(false);
    }

    _next(infohash, successful) {
        let req = this.peers.shift(infohash, successful);
        if (req) {
            this.ignore(req.infohash.toString('hex'), req.rinfo, function (drop) {
                if (!drop) {
                    this.emit('download', req.rinfo, req.infohash);
                }
            }.bind(this));
        }
    }

    _download(rinfo, infohash) {
        this.activeConnections++;

        let successful = false;
        let socket = new net.Socket();

        socket.setTimeout(this.timeout || 5000);
        socket.connect(rinfo.port, rinfo.address, function () {
            let wire = new Wire(infohash);
            socket.pipe(wire).pipe(socket);

            wire.on('metadata', function (metadata, infoHash) {
                successful = true;
                this.emit('complete', metadata, infoHash, rinfo);
                socket.destroy();
            }.bind(this));

            wire.on('fail', function () {
                socket.destroy();
            }.bind(this));

            wire.sendHandshake();
        }.bind(this));

        socket.on('error', function (err) {
            socket.destroy();
        }.bind(this));

        socket.on('timeout', function (err) {
            socket.destroy();
        }.bind(this));

        socket.once('close', function () {
            this.activeConnections--;
            this._next(infohash, successful);
        }.bind(this));
    }

    add(rinfo, infohash) {
        this.peers.push({infohash: infohash, rinfo: rinfo});
        if (this.activeConnections < this.maxConnections && this.peers.length() > 0) {
            this._next();
        }
    }

    isIdle() {
        return this.peers.length() === 0;
    }
}

util.inherits(BTClient, EventEmitter);

export default BTClient;
