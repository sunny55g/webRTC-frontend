
// Global variables
let localConnection = null;
let dataChannel = null;
let ws = null;
let isConnected = false;
let currentMode = 'sender'; // 'sender' or 'receiver'
let userName = '';
let targetAddress = '';

// DOM elements
const statusBadge = document.getElementById('status-badge');
const modeBadge = document.getElementById('mode-badge');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const nameInput = document.getElementById('name');
const targetAddressInput = document.getElementById('target-address');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages-container');
const localAddressDisplay = document.getElementById('local-address');
const remoteAddressDisplay = document.getElementById('remote-address');

// Event listeners
connectBtn.addEventListener('click', handleConnect);
disconnectBtn.addEventListener('click', handleDisconnect);
toggleModeBtn.addEventListener('click', toggleMode);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initialize
updateUI();

// Helper functions
function parseAddress(address) {
    const parts = address.split(':');
    if (parts.length === 2) {
        return {
            ip: parts[0].trim(),
            port: parts[1].trim()
        };
    }
    return null;
}

function validateIP(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip) || ip === 'localhost' || ip === '127.0.0.1';
}

function validatePort(port) {
    const portNum = parseInt(port);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
}

function addMessage(sender, content, type = 'received') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    
    if (type !== 'system') {
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = sender;
        messageDiv.appendChild(senderDiv);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    messageDiv.appendChild(contentDiv);
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString();
    messageDiv.appendChild(timeDiv);
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = content;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateUI() {
    statusBadge.textContent = isConnected ? '✅ Connected' : '⚠️ Disconnected';
    statusBadge.className = `status-badge ${isConnected ? 'connected' : ''}`;
    
    modeBadge.textContent = `Mode: ${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}`;
    
    connectBtn.disabled = isConnected;
    disconnectBtn.disabled = !isConnected;
    
    nameInput.disabled = isConnected;
    targetAddressInput.disabled = isConnected;
    
    messageInput.disabled = !isConnected;
    sendBtn.disabled = !isConnected;
    
    toggleModeBtn.textContent = `Switch to ${currentMode === 'sender' ? 'Receiver' : 'Sender'} Mode`;
    
    if (currentMode === 'receiver') {
        targetAddressInput.placeholder = 'Not required in receiver mode';
        targetAddressInput.style.opacity = '0.5';
    } else {
        targetAddressInput.placeholder = '127.0.0.1:8080';
        targetAddressInput.style.opacity = '1';
    }
}

function setupPeerConnection() {
    console.log('Setting up peer connection...');
    
    localConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    });

    localConnection.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending ICE candidate');
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                targetAddress: targetAddress,
                senderName: userName
            }));
        }
    };

    localConnection.onconnectionstatechange = () => {
        const state = localConnection.connectionState;
        console.log('Connection state:', state);
        
        if (state === 'connected') {
            isConnected = true;
            addSystemMessage('P2P connection established successfully!');
            updateUI();
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            if (state === 'failed') {
                addSystemMessage('Connection failed. Please try again.');
                handleDisconnect();
            }
        }
    };

    localConnection.ondatachannel = (event) => {
        console.log('Data channel received');
        dataChannel = event.channel;
        setupDataChannel();
    };

    // If sender, create data channel
    if (currentMode === 'sender') {
        dataChannel = localConnection.createDataChannel('chat', {
            ordered: true
        });
        setupDataChannel();
    }
}

function setupDataChannel() {
    if (!dataChannel) return;
    
    console.log('Setting up data channel...');

    dataChannel.onopen = () => {
        console.log('Data channel opened');
        addSystemMessage('Ready to send messages!');
    };

    dataChannel.onmessage = (event) => {
        console.log('Received message:', event.data);
        try {
            const data = JSON.parse(event.data);
            addMessage(data.sender, data.content, 'received');
        } catch (e) {
            addMessage('Remote', event.data, 'received');
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
        addSystemMessage('Message channel closed');
    };

    dataChannel.onerror = (error) => {
        console.error('Data Channel Error:', error);
        addSystemMessage('Error in message channel');
    };
}

function connectToSignalingServer() {
    // Use a reliable signaling server
    const wsUrl = 'wss://webrtc-backend-wd3d.onrender.com';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to signaling server');
        addSystemMessage('Connected to signaling server');
        
        // Create room based on target address or generate one for receiver
        const roomId = currentMode === 'sender' ? targetAddress : `receiver_${Date.now()}`;
        
        ws.send(JSON.stringify({
            type: 'join',
            room: roomId,
            name: userName,
            mode: currentMode,
            targetAddress: currentMode === 'sender' ? targetAddress : null
        }));
        
        setupPeerConnection();
        
        // Update UI with connection info
        localAddressDisplay.textContent = currentMode === 'receiver' ? `Waiting on room: ${roomId}` : 'Connecting...';
        remoteAddressDisplay.textContent = currentMode === 'sender' ? targetAddress : 'Waiting for sender...';
    };

    ws.onmessage = async (event) => {
        try {
            const message = JSON.parse(event.data);
            await handleSignalingMessage(message);
        } catch (error) {
            console.error('Error handling signaling message:', error);
        }
    };

    ws.onclose = () => {
        console.log('Signaling server disconnected');
        addSystemMessage('Signaling server disconnected');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addSystemMessage('Failed to connect to signaling server');
    };
}

async function handleSignalingMessage(message) {
    console.log('Received signaling message:', message);
    
    switch (message.type) {
        case 'offer':
            if (currentMode === 'receiver') {
                await handleOffer(message.offer, message.senderName);
            }
            break;
        case 'answer':
            if (currentMode === 'sender') {
                await handleAnswer(message.answer);
            }
            break;
        case 'ice-candidate':
            await handleIceCandidate(message.candidate);
            break;
        case 'user-joined':
            if (currentMode === 'sender' && message.mode === 'receiver') {
                addSystemMessage('Receiver found, establishing connection...');
                await createOffer();
            }
            break;
        case 'error':
            addSystemMessage(`Error: ${message.message}`);
            break;
    }
}

async function createOffer() {
    try {
        console.log('Creating offer...');
        const offer = await localConnection.createOffer();
        await localConnection.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            targetAddress: targetAddress,
            senderName: userName
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
        addSystemMessage('Failed to create connection offer');
    }
}

async function handleOffer(offer, senderName) {
    try {
        console.log('Handling offer from:', senderName);
        await localConnection.setRemoteDescription(offer);
        const answer = await localConnection.createAnswer();
        await localConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
            type: 'answer',
            answer: answer,
            targetAddress: targetAddress,
            receiverName: userName
        }));
        
        addSystemMessage(`Connection offer received from ${senderName}`);
    } catch (error) {
        console.error('Error handling offer:', error);
        addSystemMessage('Failed to handle connection offer');
    }
}

async function handleAnswer(answer) {
    try {
        console.log('Handling answer...');
        await localConnection.setRemoteDescription(answer);
        addSystemMessage('Connection answer received');
    } catch (error) {
        console.error('Error handling answer:', error);
        addSystemMessage('Failed to handle connection answer');
    }
}

async function handleIceCandidate(candidate) {
    try {
        await localConnection.addIceCandidate(candidate);
        console.log('ICE candidate added');
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

// Event handlers
function handleConnect() {
    userName = nameInput.value.trim();
    
    if (!userName) {
        addSystemMessage('Please enter your name');
        return;
    }

    if (currentMode === 'sender') {
        targetAddress = targetAddressInput.value.trim();
        
        if (!targetAddress) {
            addSystemMessage('Please enter target address (IP:Port)');
            return;
        }

        const parsed = parseAddress(targetAddress);
        if (!parsed) {
            addSystemMessage('Invalid address format. Use IP:PORT (e.g., 127.0.0.1:8080)');
            return;
        }

        if (!validateIP(parsed.ip) || !validatePort(parsed.port)) {
            addSystemMessage('Invalid IP address or port');
            return;
        }
    }

    addSystemMessage(`Connecting as ${currentMode}...`);
    connectToSignalingServer();
}

function handleDisconnect() {
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
    
    isConnected = false;
    localAddressDisplay.textContent = 'Not connected';
    remoteAddressDisplay.textContent = 'Not connected';
    
    addSystemMessage('Disconnected');
    updateUI();
}

function toggleMode() {
    if (isConnected) {
        handleDisconnect();
    }
    
    currentMode = currentMode === 'sender' ? 'receiver' : 'sender';
    targetAddressInput.value = '';
    updateUI();
    
    addSystemMessage(`Switched to ${currentMode} mode`);
}

function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !dataChannel || dataChannel.readyState !== 'open') {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            addSystemMessage('Connection not ready. Please wait or reconnect.');
        }
        return;
    }

    const messageData = {
        sender: userName,
        content: content,
        timestamp: new Date().toISOString()
    };
    
    try {
        dataChannel.send(JSON.stringify(messageData));
        addMessage(userName, content, 'sent');
        messageInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        addSystemMessage('Failed to send message');
    }
}

console.log('TCP/IP Messenger initialized');
