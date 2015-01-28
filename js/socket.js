$(function() {

	var ip = null;
	var port = null;

	var serverSocketId = null;
	var socketId = null;

	var transactionId = 0;
	var currentCommandOptions = "";
	var currentCommandCallback = "";

	var initialCommandQueue = [];


	/* RESPONSE object */

	var Response = (function() {

		var expectedLen = null;
		var partialData = "";


		var publicMethods = {

			process: function(data) {
				var split_data = ab2str(data).split("\0");

				if (split_data.length == 1) {
					// remainder of previous reponse
					partialData += split_data[0];

				} else if (split_data.length >= 2) {
					// begining of new reponse
					this.expectedLen = parseInt(split_data[0]);
					this.partialData = split_data[1];

					if (! this.expectedLen) {
						throw "Expected numeric length.";
					}
				}

			},

			isComplete: function() {
				if (this.expectedLen == this.partialData.length) {
					return true;
				} else {
					console.log("Expecting " + this.expectedLen + " bytes...");
					console.log("Received so far " + this.partialData.length + " bytes.");
					return false;
				}
			},

			getXML: function() {
				return $.parseXML(this.partialData);
			}

		}

		return publicMethods;

	})();


	// CONECT WITH XDEBUG SERVER

	function listen_and_connect() {
		ip = Config.get("listening_ip");
		port = parseInt(Config.get("listening_port"));

		initialCommandQueue = [
			{ command: "feature_set", params: "-n max_depth -v 3" },
			{ command: "feature_set", params: "-n max_data -v 50000" },
			{ command: "step_into", params: null },
		];

		chrome.sockets.tcpServer.create(function(createInfo) {
			//console.log("Create Info:"); console.log(createInfo);
			serverSocketId = createInfo.socketId;

			Alert.busy("Listening on: " + ip + ":" + port);
			chrome.sockets.tcpServer.listen(serverSocketId, ip, port, function(result) {
				//console.log("Listen result: "); console.log(result);
			});

			chrome.sockets.tcpServer.onAccept.addListener(function(acceptInfo) {
				//console.log("Accepted: "); console.log(acceptInfo);
				socketId = acceptInfo.clientSocketId;

				closeSockets(true, false); // we don't need the server socket anymore

				chrome.sockets.tcp.update(socketId, { bufferSize: (1024*1024) }, function() {
					chrome.sockets.tcp.setPaused(socketId, false);
				});
			});
		});


		chrome.sockets.tcp.onReceiveError.addListener(function(errorInfo) {
			$("body").trigger('error-on-receive', {
				message: errorInfo.resultCode
			});
		});


		chrome.sockets.tcp.onReceive.addListener(function(readInfo) {

			try {
				Response.process(readInfo.data);
				if (! Response.isComplete()) return;
				var xml = Response.getXML();
			} catch (e) {
				console.error(e);
				return;
			}


			if ($(xml).find("init").length > 0) {

				console.log("received init response:");
				console.log(xml);

				var c = initialCommandQueue.shift(); // next command
				c && send_command(c.command, c.params);

			} else if ($(xml).find("response").length > 0) {

				var received_transaction_id = $(xml).find("response").attr("transaction_id");
				if (received_transaction_id == transactionId) {

					console.log("received_transaction_id: " + received_transaction_id);
					console.log(xml);

					if (currentCommandCallback) {

						currentCommandCallback(xml);

					} else {

						var received_command = $(xml).find("response").attr("command");
						if (received_command) {
							$('body').trigger('parse-xml', {
								command: received_command,
								options: currentCommandOptions,
								xml: xml
							});
						}

					}

					var c = initialCommandQueue.shift(); // next command
					c && send_command(c.command, c.params);
				}

			}

		});

	}


	function send_command(command, options, callback) {
		var request = "";

		currentCommandOptions = options;
		currentCommandCallback = callback;

		request += addTransactionId(command);
		if (options) {
			request += " " + options;
		}
		request += "\0";

		console.log("##### Sending command: " + request);

		// not sure if the delay is absolutely necessary
		setTimeout(function() {
			chrome.sockets.tcp.send(socketId, str2ab(request), function(writeInfo) {
				if (writeInfo.resultCode == 0) { // no error
					//chrome.sockets.tcp.setPaused(socketId, false);
				}
			});
		}, 100);
	}


	function closeSockets(serverSocket, clientSocket) {

		if (serverSocket && serverSocketId) {
			chrome.sockets.tcpServer.close(serverSocketId, function() {
				serverSocketId = null;
				if (chrome.runtime.lastError) {
					console.log("Server socket: " + chrome.runtime.lastError.message);
				}
			});
		}

		if (clientSocket && socketId) {
			chrome.sockets.tcp.close(socketId, function() {
				socketId = null;
				if (chrome.runtime.lastError) {
					console.log("Client socket: " + chrome.runtime.lastError.message);
				}
			});
		}

	}


	// HANDLE EVENTS

	$('body').on("xdebug-listen", function() {
		listen_and_connect();
		$('body').trigger('socket_status', {status: 'live'});
	});

	$('body').on("xdebug-step_over", function() {
		send_command("step_over");
	});

	$('body').on("xdebug-step_out", function() {
		send_command("step_out");
	});

	$('body').on("xdebug-step_into", function() {
		send_command("step_into");
	});

	$('body').on("xdebug-run", function() {
		send_command("run");
	});

	$('body').on("xdebug-stop", function() {
		$('body').trigger('parse-xml', {
			command: "stop",
			xml: ''
		});

		closeSockets(true, true);
		$('body').trigger('socket_status', {status: 'dead'});
	});

	$("body").on("xdebug-eval", function(event, data) {
		send_command("eval", "-- " + data.expression);
	});

	$("body").on("xdebug-source", function(event, data) {
		var lineno = parseInt(data.lineno);
		var linesCount = parseInt(Config.get("lines_count"));

		var begin = Math.max((lineno - linesCount), 1);
		var end = lineno + linesCount;
		send_command("source", "-b " + begin + " -e " + end + " -f " + data.filename);
	});

	$("body").on("xdebug-stack_get", function() {
		send_command("stack_get");
	});

	$("body").on("xdebug-breakpoint_set", function(event, data) {
		send_command("breakpoint_set", "-t line -f " + data.filename + " -n " + data.lineno);
	});

	$("body").on("xdebug-breakpoint_set-return", function(event, data) {
		send_command("eval", "-- " + btoa("json_encode(reset(debug_backtrace()))"), function(xml) {
			var property = $(xml).find("property");
			var object = JSON.parse(atob(property.text()));

			if (object.function != "unknown") {
				if (object.class) { function_name = object.class + "::" + object.function; }
				send_command("breakpoint_set", "-t return -m " + function_name, function() {
					Alert.info("Breakpoint will trigger on function return.");
				});
			} else {
				Alert.warn("Couldn't determine function name - no breakpoint set!");
			}
		});
	});

	$("body").on("xdebug-breakpoint_remove", function(event, data) {
		send_command("breakpoint_remove", "-d " + data.breakpoint_id);
	});





	// HELPERS

	function addTransactionId(str) {
		transactionId++;
		str += " -i " + transactionId;
		return str;
	}

	// http://updates.html5rocks.com/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
	function ab2str(arraybuffer_data) {
		return String.fromCharCode.apply(null, new Uint8Array(arraybuffer_data));
	}

	// http://updates.html5rocks.com/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
	function str2ab(str) {
		var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
		var bufView = new Uint8Array(buf);
		for (var i=0, strLen=str.length; i<strLen; i++) {
			bufView[i] = str.charCodeAt(i);
		}
		return buf;
	}

});



