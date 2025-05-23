window.addEventListener('DOMContentLoaded', () => {
// Global variables
let localConnection = null;
let dataChannel = null;
let ws = null;
let username = '';
let localPort = '';
let targetIP = '';
let targetPort = '';
let isSenderMode = true;

// DOM elements
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

// Event listeners
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

// Toggle between sender and receiver mode
function toggleMode() {
    handleDisconnection();
    isSenderMode = !isSenderMode;
    updateUIForMode();
}

// Parse IP:Port format
function parseIpPort(ipPortString) {
    const regex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
    const match = ipPortString.match(regex);
    
    if (match) {
        const ip = match[1];
        const port = match[2];
        
        // Validate IP address format
        const ipParts = ip.split('.');
        if (ipParts.length === 4 && ipParts.every(part => {
            const num = parseInt(part, 10);
            return !isNaN(num) && num >= 0 && num <= 255;
        })) {
            // Validate port range
            const portNum = parseInt(port, 10);
            if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
                return { ip, port };
            }
        }
    }
    
    return null;
}

// Update UI based on the current mode
function updateUIForMode() {
    modeDisplay.textContent = isSenderMode ? 'Sender' : 'Receiver';
    toggleModeBtn.textContent = isSenderMode ? 'Switch to Receiver Mode' : 'Switch to Sender Mode';
    
    // Show or hide target input fields based on mode
    const targetGroups = document.querySelectorAll('.target-group');
    targetGroups.forEach(group => {
        group.style.display = isSenderMode ? 'block' : 'none';
    });

    if (!isSenderMode) {
        targetAddressInput.value = '';
    }
}

// Handle establishing connection
function handleConnection() {
    username = nameInput.value.trim();
    localPort = localPortInput.value.trim();
    
    // Parse target address (IP:Port)
    if (isSenderMode) {
        const targetAddress = targetAddressInput.value.trim();
        const parsed = parseIpPort(targetAddress);
        
        if (!parsed) {
            addSystemMessage('Invalid target address format. Please use IP:Port (e.g., 127.0.0.1:8080)');
            return;
        }
        
        targetIP = parsed.ip;
        targetPort = parsed.port;
    }

    if (!username || !localPort || (isSenderMode && !targetIP)) {
        addSystemMessage('Please fill in all required fields.');
        return;
    }

    // Connect to signaling server
    ws = new WebSocket('wss://webrtc-backend-wd3d.onrender.com');

    ws.onopen = () => {
        // Send initialization data to signaling server
        ws.send(JSON.stringify({
            type: 'init',
            name: username,
            localIP: getLocalIP(),
            localPort: localPort,
            targetIP: targetIP,
            targetPort: targetPort,
            mode: isSenderMode ? 'sender' : 'receiver'
        }));

        setupPeer();
        
if (isSenderMode) {
    dataChannel = localConnection.createDataChannel("chat");

    dataChannel.onopen = () => {
        console.log("✅ Sender: Data channel is open");
        setupDataChannel();

        localConnection.createOffer()
            .then(offer => localConnection.setLocalDescription(offer))
            .then(() => {
                sendSignal({ sdp: localConnection.localDescription });
            })
            .catch(error => {
                console.error("Error creating offer:", error);
                addSystemMessage("Error creating connection offer.");
            });
    };

    dataChannel.onerror = (error) => {
        console.error("❌ Sender: Data Channel Error:", error);
        addSystemMessage('Error in data channel');
    };
}


        // Update connection details display
        const localAddress = `${getLocalIP()}:${localPort}`;
        const remoteAddress = isSenderMode ? `${targetIP}:${targetPort}` : 'Waiting for connection...';
        
        localAddressDisplay.textContent = localAddress;
        remoteAddressDisplay.textContent = remoteAddress;
        
        setConnectedState(true);
    };

    ws.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log("Received message:", msg);
            
            if (msg.type === 'init_response') {
                addSystemMessage(msg.message || "Connected to signaling server");
            } 
            else if (msg.type === 'peer_found') {
                addSystemMessage(`Peer found: ${msg.peerIP}:${msg.peerPort}`);
                remoteAddressDisplay.textContent = `${msg.peerIP}:${msg.peerPort}`;
            }
            else if (msg.type === 'signal' && msg.data) {
                if (msg.data.sdp) {
                    await localConnection.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
                    
                    if (msg.data.sdp.type === 'offer') {
                        // Create and send answer if we received an offer
                        localConnection.createAnswer()
                            .then(answer => localConnection.setLocalDescription(answer))
                            .then(() => {
                                sendSignal({ sdp: localConnection.localDescription });
                            })
                            .catch(error => {
                                console.error("Error creating answer:", error);
                                addSystemMessage("Error responding to connection offer.");
                            });
                    }
                } else if (msg.data.candidate) {
                    try {
                        await localConnection.addIceCandidate(new RTCIceCandidate(msg.data));
                    } catch (e) {
                        console.error('Error adding received ice candidate', e);
                    }
                }
            }
            else if (msg.type === 'error') {
                addSystemMessage(`Error: ${msg.message}`);
                handleDisconnection();
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    };

    ws.onerror = err => {
        console.error('WebSocket error:', err);
        addSystemMessage('Error connecting to signaling server');
    };
    
    ws.onclose = () => addSystemMessage('Disconnected from signaling server');
}

// Set up WebRTC peer connection
function setupPeer() {
    localConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    localConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignal(event.candidate);
        }
    };

    localConnection.onconnectionstatechange = () => {
        console.log("Connection state:", localConnection.connectionState);
        if (localConnection.connectionState === 'connected') {
            addSystemMessage("WebRTC connection established");
        } else if (localConnection.connectionState === 'disconnected' || 
                  localConnection.connectionState === 'failed' || 
                  localConnection.connectionState === 'closed') {
            addSystemMessage(`WebRTC connection ${localConnection.connectionState}`);
        }
    };

    localConnection.ondatachannel = event => {
        dataChannel = event.channel;
        console.log("📥 Receiver got data channel", event.channel);
        setupDataChannel();
    };
}

// Send signaling data to peer via signaling server
function sendSignal(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'signal',
            name: username,
            localIP: getLocalIP(),
            localPort: localPort,
            targetIP: targetIP,
            targetPort: targetPort,
            mode: isSenderMode ? 'sender' : 'receiver',
            data: data
        }));
    }
}

// Set up the data channel for messaging
function setupDataChannel() {
dataChannel.onopen = () => {
  console.log("✅ Sender: Data channel open");
  addSystemMessage('Direct P2P connection established');
  messageInput.disabled = false;
  sendBtn.disabled = false;

  // ✅ Safe to create and send offer now
  localConnection.createOffer()
    .then(offer => localConnection.setLocalDescription(offer))
    .then(() => {
      sendSignal({ sdp: localConnection.localDescription });
    })
    .catch(error => {
      console.error("Error creating offer:", error);
      addSystemMessage("Error creating connection offer.");
    });
};


    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            addMessageToChat(data, false);
        } catch (e) {
            // If it's not JSON, treat it as plain text
            const msg = {
                sender: isSenderMode ? targetIP : 'Peer',
                content: event.data,
                timestamp: new Date().toISOString()
            };
            addMessageToChat(msg, false);
        }
    };

    dataChannel.onclose = () => {
        addSystemMessage('P2P connection closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
    };

    dataChannel.onerror = (error) => {
        console.error("❌ Data channel error:", error);
        console.error("Data Channel Error:", error);
        addSystemMessage('Error in data channel');
    };
}

// Send a message to the peer
function sendMessage() {
    const content = messageInput.value.trim();
    if (content && dataChannel && dataChannel.readyState === 'open') {
        const msg = {
            sender: username,
            content: content,
            timestamp: new Date().toISOString()
        };
        
        try {
            dataChannel.send(JSON.stringify(msg));
            addMessageToChat(msg, true);
            messageInput.value = '';
        } catch (e) {
            console.error("Error sending message:", e);
            addSystemMessage('Failed to send message');
        }
    }
}

// Add a message to the chat UI
function addMessageToChat(messageData, isSent) {
    const msg = document.createElement('div');
    msg.className = `message ${isSent ? 'sent' : 'received'}`;

    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = messageData.sender;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = messageData.content;

    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date(messageData.timestamp).toLocaleTimeString();

    msg.appendChild(sender);
    msg.appendChild(content);
    msg.appendChild(timestamp);
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add a system message to the chat
function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = text;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Update UI elements based on connection state
function setConnectedState(connected) {
    statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    messageInput.disabled = !connected;
    sendBtn.disabled = !connected;
}

// Handle disconnection
function handleDisconnection() {
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    if (localConnection) {
        localConnection.close();
        localConnection = null;
    }
    
    if (ws) {
        ws.close();
        ws = null;
    }
    
    setConnectedState(false);
    addSystemMessage('Disconnected');
    clearConnectionDetails();
}

// Clear connection details in UI
function clearConnectionDetails() {
    localAddressDisplay.textContent = 'Not connected';
    remoteAddressDisplay.textContent = 'Not connected';
}

// Helper function to get local IP (simplified version)
function getLocalIP() {
    // In a real app, you would use a proper method to get the actual IP
    // This is a placeholder that would be replaced with actual IP detection
    return "local.ip.address";
}

// Initialize UI based on current mode
updateUIForMode();
});
