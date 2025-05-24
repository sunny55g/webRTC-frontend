// ✅ Fully Patched script.js with full logging and ICE candidate tracing

window.addEventListener('DOMContentLoaded', () => {
    let localConnection = null;
    let dataChannel = null;
    let ws = null;
    let username = '';
    let localPort = '';
    let targetIP = '';
    let targetPort = '';
    let isSenderMode = true;

    const statusBadge = document.querySelector('.status-badge');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const toggleModeBtn = document.getElementById('toggle-mode-btn');
    const nameInput = document.getElementById('name');
    const localPortInput = document.getElementById('local-port');
    const targetAddressInput = document.getElementById('target-address');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const messagesContainer = document.getElementById('messages');
    const modeDisplay = document.getElementById('mode-display');
    const localAddressDisplay = document.getElementById('local-address');
    const remoteAddressDisplay = document.getElementById('remote-address');

    connectBtn.addEventListener('click', handleConnection);
    disconnectBtn.addEventListener('click', handleDisconnection);
    toggleModeBtn.addEventListener('click', toggleMode);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function toggleMode() {
        handleDisconnection();
        isSenderMode = !isSenderMode;
        updateUIForMode();
    }

    function parseIpPort(ipPortString) {
        const regex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
        const match = ipPortString.match(regex);
        if (match) {
            const ip = match[1];
            const port = match[2];
            const ipParts = ip.split('.');
            const portNum = parseInt(port, 10);
            if (
                ipParts.length === 4 &&
                ipParts.every(part => !isNaN(parseInt(part)) && parseInt(part) >= 0 && parseInt(part) <= 255) &&
                portNum >= 1 && portNum <= 65535
            ) {
                return { ip, port };
            }
        }
        return null;
    }

    function updateUIForMode() {
        modeDisplay.textContent = isSenderMode ? 'Sender' : 'Receiver';
        toggleModeBtn.textContent = isSenderMode ? 'Switch to Receiver Mode' : 'Switch to Sender Mode';
        document.querySelectorAll('.target-group').forEach(group => {
            group.style.display = isSenderMode ? 'block' : 'none';
        });
        if (!isSenderMode) targetAddressInput.value = '';
    }

    function handleConnection() {
        username = nameInput.value.trim();
        localPort = localPortInput.value.trim();

        if (isSenderMode) {
            const targetAddress = targetAddressInput.value.trim();
            const parsed = parseIpPort(targetAddress);
            if (!parsed) {
                addSystemMessage('Invalid target address format. Use IP:Port (e.g., 127.0.0.1:8080)');
                return;
            }
            targetIP = parsed.ip;
            targetPort = parsed.port;
        }

        if (!username || !localPort || (isSenderMode && !targetIP)) {
            addSystemMessage('Please fill in all required fields.');
            return;
        }

        ws = new WebSocket('wss://webrtc-backend-wd3d.onrender.com');

        ws.onopen = () => {
            const trySendInit = () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'init',
                        name: username,
                        localIP: getLocalIP(),
                        localPort,
                        targetIP,
                        targetPort,
                        mode: isSenderMode ? 'sender' : 'receiver'
                    }));

                    setupPeer();

                    if (isSenderMode) {
                        dataChannel = localConnection.createDataChannel("chat");
                        dataChannel.onopen = () => {
                            console.log("✅ Data channel open");
                            setupDataChannel();
                            localConnection.createOffer()
                                .then(offer => localConnection.setLocalDescription(offer))
                                .then(() => sendSignal({ sdp: localConnection.localDescription }))
                                .catch(err => addSystemMessage("Error creating offer: " + err));
                        };
                        dataChannel.onerror = err => addSystemMessage("Data Channel Error: " + err);
                    }

                    localAddressDisplay.textContent = `${getLocalIP()}:${localPort}`;
                    remoteAddressDisplay.textContent = isSenderMode ? `${targetIP}:${targetPort}` : 'Waiting for connection...';
                    setConnectedState(true);

                } else {
                    setTimeout(trySendInit, 50);
                }
            };
            trySendInit();
        };

        ws.onmessage = async event => {
            try {
                const msg = JSON.parse(event.data);
                console.log("🔁 Received message:", msg);
                if (msg.type === 'signal' && msg.data) {
                    if (msg.data.sdp) {
                        await localConnection.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
                        if (msg.data.sdp.type === 'offer') {
                            localConnection.createAnswer()
                                .then(answer => localConnection.setLocalDescription(answer))
                                .then(() => sendSignal({ sdp: localConnection.localDescription }))
                                .catch(err => console.error("Answer creation error:", err));
                        }
                    } else if (msg.data.candidate) {
                        console.log("🧊 Adding ICE candidate:", msg.data);
                        await localConnection.addIceCandidate(new RTCIceCandidate(msg.data));
                    }
                } else if (msg.type === 'error') {
                    addSystemMessage("Error: " + msg.message);
                    handleDisconnection();
                }
            } catch (err) {
                console.error("❌ Error handling message:", err);
            }
        };

        ws.onerror = err => addSystemMessage("WebSocket error: " + err);
        ws.onclose = () => addSystemMessage('Disconnected from signaling server');
    }

    function setupPeer() {
        localConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        localConnection.onicecandidate = e => {
            if (e.candidate) {
                console.log("📤 Sending ICE candidate", e.candidate);
                sendSignal(e.candidate);
            }
        };
        localConnection.onconnectionstatechange = () => {
            console.log("🔌 Connection state:", localConnection.connectionState);
        };
        localConnection.ondatachannel = event => {
            console.log("📥 Receiver got data channel", event.channel);
            dataChannel = event.channel;
            setupDataChannel();
        };
    }

    function sendSignal(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'signal',
                name: username,
                localIP: getLocalIP(),
                localPort,
                targetIP,
                targetPort,
                mode: isSenderMode ? 'sender' : 'receiver',
                data
            }));
        }
    }

    function setupDataChannel() {
        dataChannel.onopen = () => {
            console.log("✅ Data channel is ready");
            addSystemMessage('P2P channel open');
            messageInput.disabled = false;
            sendBtn.disabled = false;
        };
        dataChannel.onmessage = event => {
            console.log("💬 Received message on data channel:", event.data);
            try {
                const data = JSON.parse(event.data);
                addMessageToChat(data, false);
            } catch (e) {
                addMessageToChat({ sender: 'Peer', content: event.data, timestamp: new Date().toISOString() }, false);
            }
        };
        dataChannel.onclose = () => {
            console.warn("⚠️ Data channel closed");
            addSystemMessage('P2P connection closed');
        };
        dataChannel.onerror = err => {
            console.error("❌ Data channel error:", err);
            addSystemMessage('Data channel error: ' + err);
        };
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (content && dataChannel?.readyState === 'open') {
            const msg = { sender: username, content, timestamp: new Date().toISOString() };
            try {
                dataChannel.send(JSON.stringify(msg));
                console.log("📤 Sent message:", msg);
                addMessageToChat(msg, true);
                messageInput.value = '';
            } catch (e) {
                console.error("❌ Failed to send message:", e);
                addSystemMessage("Send failed: " + e);
            }
        }
    }

    function addMessageToChat(msg, isSent) {
        const message = document.createElement('div');
        message.className = `message ${isSent ? 'sent' : 'received'}`;
        message.innerHTML = `<div class="sender">${msg.sender}</div><div class="content">${msg.content}</div><div class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>`;
        messagesContainer.appendChild(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function addSystemMessage(text) {
        const el = document.createElement('div');
        el.className = 'system-message';
        el.textContent = text;
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function setConnectedState(connected) {
        statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
        statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
        connectBtn.disabled = connected;
        disconnectBtn.disabled = !connected;
        messageInput.disabled = !connected;
        sendBtn.disabled = !connected;
    }

    function handleDisconnection() {
        dataChannel?.close();
        localConnection?.close();
        ws?.close();
        dataChannel = null;
        localConnection = null;
        ws = null;
        setConnectedState(false);
        addSystemMessage('Disconnected');
        clearConnectionDetails();
    }

    function clearConnectionDetails() {
        localAddressDisplay.textContent = 'Not connected';
        remoteAddressDisplay.textContent = 'Not connected';
    }

    function getLocalIP() {
        return 'local.ip.address';
    }

    updateUIForMode();
});
