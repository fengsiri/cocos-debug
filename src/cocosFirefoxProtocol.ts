import * as EE from 'events';

export class CocosFXEvent {
	event: string;
	body: any;

	public constructor(event: string, body?: any) {
		this.event = event;
		if (body) {
			this.body = body;
		}
	}
}

export class CocosFXProtocol extends EE.EventEmitter {
	private static TIMEOUT = 3000;

    private _writableStream: NodeJS.WritableStream;
	// first call back is null for response of root
	private _pendingRequests = [null];
	private _rawData = '';

	private _bodyStartIndex: number = 0;
	private _bodyLength: number = 0;

	public startDispatch(inStream: NodeJS.ReadWriteStream, outStream: NodeJS.WritableStream): void {
		this._writableStream = outStream;
		inStream.on('data', (data) => this.execute(data));
		inStream.on('close', () => {
			this.emitEvent(new CocosFXEvent('close'));
		});
		inStream.on('error', (error) => {
			this.emitEvent(new CocosFXEvent('error', 'input stream error'));
		});

		outStream.on('error', (error) => {
			this.emitEvent(new CocosFXEvent('error', 'error happend in send request'));
		});

		inStream.resume();
	}

	public command(request: any, cb?: (result) => void) : void {
		this._command(request, cb);
	}

	public command2(request: any) : Promise<any> {
		return new Promise((resolve, reject) => {
			this._command(request, result => {
				resolve(result);
			});
		});
	}

	private _command(request: any, cb: (result) => void) : void {

        if (cb) {
		    this._pendingRequests.push(cb);
		}
		else {
			this._pendingRequests.push(null);
		}

		this.send(request);
	}

    private emitEvent(event: CocosFXEvent) {
		this.emit(event.event, event);
	}

	private send(request: any) {
		let content = JSON.stringify(request);
		let length = content.length;
		let packet = length.toString() + ':' + content;
		if (this._writableStream) {
			this._writableStream.write(packet);
		}
	}

	private execute(data): void {
		this._rawData += data;
		let packet;
        while(packet = this.extractPacket()) {

			try {
				// should remove first cb event there is an error in parsing json data
				let cb = this._pendingRequests.shift();

				let body = JSON.parse(packet);

				if (cb === undefined) {
					// it is an event sent by remote
					this.emitEvent(new CocosFXEvent('break', body));
				}
				else {
					if (cb) {
						cb(body);
					}
				}
			} catch (e) {
				// Can not parse the message from remote.
				this.emitEvent(new CocosFXEvent('error', 'received error packet: invalid content: ' + data));
			}
		}
	}

	private extractPacket() {

        if (this._rawData === '') {
			return;
		}

		if (this._bodyStartIndex === 0) {
			let sep = this._rawData.indexOf(':');
			if (sep < 0) {
				// not enough data received
				return;
			}

			this._bodyStartIndex = sep + 1;
		}

        if (this._bodyLength === 0) {
			let countString = this._rawData.substring(0, this._bodyStartIndex - 1);
			if (!/^[0-9]+$/.exec(countString)) {
				this.emitEvent(new CocosFXEvent('error', 'received error packet: invalid length'));
				return;
			}

			this._bodyLength = parseInt(countString);
		}

		// The body length is byte length
		const resRawByteLength = Buffer.byteLength(this._rawData, 'utf8');
		if (resRawByteLength - this._bodyStartIndex  >= this._bodyLength) {
			const buf = new Buffer(resRawByteLength);
			buf.write(this._rawData);

			let packet = buf.slice(this._bodyStartIndex, this._bodyStartIndex + this._bodyLength).toString();
			this._rawData = buf.slice(this._bodyStartIndex + this._bodyLength).toString();

			this._bodyStartIndex = 0;
			this._bodyLength = 0;

			return packet;
		}
	}
}