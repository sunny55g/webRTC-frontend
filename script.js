
class WebRTCTerminal {
    constructor() {
        this.signalingWs = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.isConnected = false;
        this.localAddress = null;
        this.targetAddress = null;
        this.username = null;
        this.mode = 'sender';
        
        // STUN servers for NAT traversal
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
        
        this.initializeElements();
        this.setupEventListeners();
        this.log('System initialized', 'info');
    }

    initializeElements() {
        // Form elements
        this.usernameInput = document.getElementById('username');
        this.localPortInput = document.getElementById('localPort');
        this.targetAddressInput = document.getElementById('targetAddress');
        this.modeSelect = document.getElementById('mode');
        
        // Buttons
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.sendBtn = document.getElementById('sendBtn');
        this.clearLogsBtn = document.getElementById('clearLogsBtn');
        
        // Status elements
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.signalingStatus = document.getElementById('signalingStatus');
        this.webrtcStatus = document.getElementById('webrtcStatus');
        this.dataChannelStatus = document.getElementById('dataChannelStatus');
        
        // Message elements
        this.messageInput = document.getElementById('messageInput');
        this.messagesContainer = document.getElementById('messages');
        this.logsContainer = document.getElementById('logs');
    }

    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.sendBtn.disabled) {
                this.sendMessage();
            }
        });
        
        this.modeSelect.addEventListener('change', (e) => {
            this.mode = e.target.value;
            this.log(`Mode changed to: ${this.mode}`, 'info');
        });
    }

    async connect() {
        try {
            // Validate inputs
            if (!this.validateInputs()) {
                return;
            }
            
            this.username = this.usernameInput.value.trim();
            this.localAddress = `127.0.0.1:${this.localPortInput.value}`;
            this.targetAddress = this.targetAddressInput.value.trim();
            this.mode = this.modeSelect.value;
            
            this.log(`Attempting to connect as ${this.mode}`, 'info');
            this.log(`Local: ${this.localAddress}, Target: ${this.targetAddress}`, 'info');
            
            this.updateStatus('connecting', 'Connecting...');
            this.connectBtn.disabled = true;
            
            // Connect to signaling server
            await this.connectToSignalingServer();
            
        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
            this.updateStatus('disconnected', 'Connection Failed');
            this.connectBtn.disabled = false;
        }
    }

    validateInputs() {
        const username = this.usernameInput.value.trim();
        const localPort = this.localPortInput.value;
        const targetAddress = this.targetAddressInput.value.trim();
        
        if (!username) {
            this.log('Username is required', 'error');
            return false;
        }
        
        if (!localPort || localPort < 1024 || localPort > 65535) {
            this.log('Valid local port (1024-65535) is required', 'error');
            return false;
        }
        
        if (!targetAddress || !targetAddress.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)) {
            this.log('Valid target address (IP:PORT) is required', 'error');
            return false;
        }
        
        return true;
    }

    connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            // Use your deployed Render signaling server URL here
            const signalingUrl = 'wss://webrtc-backend-wd3d.onrender.com';
            // For local testing: const signalingUrl = 'ws://localhost:3000';
            
            this.signalingWs = new WebSocket(signalingUrl);
            
            this.signalingWs.onopen = () => {
                this.log('Connected to signaling server', 'success');
                this.signalingStatus.textContent = 'Connected';
                
                // Register with signaling server
                this.signalingWs.send(JSON.stringify({
                    type: 'register',
                    localAddress: this.localAddress,
                    targetAddress: this.targetAddress,
                    username: this.username,
                    mode: this.mode
                }));
                
                resolve();
            };
            
            this.signalingWs.onmessage = (event) => {
                this.handleSignalingMessage(JSON.parse(event.data));
            };
            
            this.signalingWs.onclose = () => {
                this.log('Signaling server disconnected', 'warning');
                this.signalingStatus.textContent = 'Disconnected';
            };
            
            this.signalingWs.onerror = (error) => {
                this.log('Signaling server error', 'error');
                reject(new Error('Failed to connect to signaling server'));
            };
        });
    }

    async handleSignalingMessage(message) {
        this.log(`Signaling message: ${message.type}`, 'info');
        
        switch (message.type) {
            case 'registered':
                this.log('Successfully registered with signaling server', 'success');
                await this.initializeWebRTC();
                break;
                
            case 'peer-found':
                this.log(`Peer found: ${message.peerAddress}`, 'success');
                if (this.mode === 'sender') {
                    await this.createOffer();
                }
                break;
                
            case 'offer':
                this.log('Received offer from peer', 'info');
                await this.handleOffer(message.offer);
                break;
                
            case 'answer':
                this.log('Received answer from peer', 'info');
                await this.handleAnswer(message.answer);
                break;
                
            case 'ice-candidate':
                this.log('Received ICE candidate', 'info');
                await this.handleIceCandidate(message.candidate);
                break;
                
            case 'peer-disconnected':
                this.log('Peer disconnected', 'warning');
                this.disconnect();
                break;
                
            case 'error':
                this.log(`Signaling error: ${message.message}`, 'error');
                break;
        }
    }

    async initializeWebRTC() {
        try {
            this.peerConnection = new RTCPeerConnection({
                iceServers: this.iceServers
            });
            
            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.log('Sending ICE candidate', 'info');
                    this.signalingWs.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        targetAddress: this.targetAddress
                    }));
                }
            };
            
            // Handle connection state changes
            this.peerConnection.onconnectionstatechange = () => {
                const state = this.peerConnection.connectionState;
                this.log(`WebRTC connection state: ${state}`, 'info');
                this.webrtcStatus.textContent = state;
                
                if (state === 'connected') {
                    this.isConnected = true;
                    this.updateStatus('connected', 'Connected');
                    this.disconnectBtn.disabled = false;
                } else if (state === 'disconnected' || state === 'failed') {
                    this.isConnected = false;
                    this.updateStatus('disconnected', 'Disconnected');
                }
            };
            
            // Handle incoming data channel (for receiver)
            this.peerConnection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel);
            };
            
            // Create data channel (for sender)
            if (this.mode === 'sender') {
                this.dataChannel = this.peerConnection.createDataChannel('messages', {
                    ordered: true
                });
                this.setupDataChannel(this.dataChannel);
            }
            
            this.log('WebRTC peer connection initialized', 'success');
            
        } catch (error) {
            this.log(`WebRTC initialization failed: ${error.message}`, 'error');
            throw error;
        }
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        
        this.dataChannel.onopen = () => {
            this.log('Data channel opened', 'success');
            this.dataChannelStatus.textContent = 'Open';
            this.messageInput.disabled = false;
            this.sendBtn.disabled = false;
            this.addMessage('Data channel established. You can now send messages!', 'system');
        };
        
        this.dataChannel.onclose = () => {
            this.log('Data channel closed', 'warning');
            this.dataChannelStatus.textContent = 'Closed';
            this.messageInput.disabled = true;
            this.sendBtn.disabled = true;
        };
        
        this.dataChannel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.username !== this.username) { // No echoing
                this.addMessage(`${data.username}: ${data.message}`, 'received');
                this.log('Message received via data channel', 'info');
            }
        };
        
        this.dataChannel.onerror = (error) => {
            this.log(`Data channel error: ${error}`, 'error');
        };
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.log('Created and set local offer', 'info');
            
            this.signalingWs.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                targetAddress: this.targetAddress
            }));
            
        } catch (error) {
            this.log(`Failed to create offer: ${error.message}`, 'error');
        }
    }

    async handleOffer(offer) {
        try {
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.log('Created and set local answer', 'info');
            
            this.signalingWs.send(JSON.stringify({
                type: 'answer',
                answer: answer,
                targetAddress: this.targetAddress
            }));
            
        } catch (error) {
            this.log(`Failed to handle offer: ${error.message}`, 'error');
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
            this.log('Set remote answer', 'success');
        } catch (error) {
            this.log(`Failed to handle answer: ${error.message}`, 'error');
        }
    }

    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(candidate);
            this.log('Added ICE candidate', 'info');
        } catch (error) {
            this.log(`Failed to add ICE candidate: ${error.message}`, 'error');
        }
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || !this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }
        
        const messageData = {
            username: this.username,
            message: message,
            timestamp: new Date().toISOString()
        };
        
        this.dataChannel.send(JSON.stringify(messageData));
        this.addMessage(`You: ${message}`, 'sent');
        this.messageInput.value = '';
        this.log('Message sent via data channel', 'info');
    }

    addMessage(text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString();
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        messageDiv.appendChild(timeDiv);
        messageDiv.appendChild(contentDiv);
        
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    disconnect() {
        this.log('Disconnecting...', 'info');
        
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.signalingWs) {
            this.signalingWs.close();
            this.signalingWs = null;
        }
        
        this.isConnected = false;
        this.updateStatus('disconnected', 'Disconnected');
        this.connectBtn.disabled = false;
        this.disconnectBtn.disabled = true;
        this.messageInput.disabled = true;
        this.sendBtn.disabled = true;
        
        this.signalingStatus.textContent = 'Disconnected';
        this.webrtcStatus.textContent = 'Disconnected';
        this.dataChannelStatus.textContent = 'Closed';
        
        this.log('Disconnected successfully', 'info');
    }

    updateStatus(status, text) {
        this.statusDot.className = `status-dot ${status}`;
        this.statusText.textContent = text;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        
        logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span>${message}`;
        
        this.logsContainer.appendChild(logEntry);
        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
        
        // Also log to browser console
        console.log(`[WebRTC P2P] ${message}`);
    }

    clearLogs() {
        this.logsContainer.innerHTML = '';
        this.log('Logs cleared', 'info');
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WebRTCTerminal();
});
