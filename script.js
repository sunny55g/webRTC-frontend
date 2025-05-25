
class WebRTCMessenger {
    constructor() {
        this.ws = null;
        this.pc = null;
        this.dataChannel = null;
        this.isSender = true;
        this.isConnected = false;
        this.localUsername = '';
        this.targetAddress = '';
        
        // WebSocket server URL (replace with your Render URL when deployed)
        this.signalingServerUrl = 'ws://localhost:3001';
        
        this.initializeElements();
        this.bindEvents();
        this.updateUI();
    }

    initializeElements() {
        // Connection elements
        this.nameInput = document.getElementById('name');
        this.targetAddressInput = document.getElementById('target-address');
        this.connectBtn = document.getElementById('connect-btn');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.toggleModeBtn = document.getElementById('toggle-mode-btn');
        
        // Message elements
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.messagesContainer = document.getElementById('messages-container');
        
        // Status elements
        this.statusBadge = document.getElementById('status-badge');
        this.modeBadge = document.getElementById('mode-badge');
        this.localAddress = document.getElementById('local-address');
        this.remoteAddress = document.getElementById('remote-address');
    }

    bindEvents() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.toggleModeBtn.addEventListener('click', () => this.toggleMode());
        
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.messageInput.disabled) {
                this.sendMessage();
            }
        });
    }

    updateUI() {
        // Update connection status
        if (this.isConnected) {
            this.statusBadge.textContent = '✅ Connected';
            this.statusBadge.className = 'status-badge connected';
            this.messageInput.disabled = false;
            this.sendBtn.disabled = false;
            this.connectBtn.disabled = true;
            this.disconnectBtn.disabled = false;
        } else {
            this.statusBadge.textContent = '⚠️ Disconnected';
            this.statusBadge.className = 'status-badge disconnected';
            this.messageInput.disabled = true;
            this.sendBtn.disabled = true;
            this.connectBtn.disabled = false;
            this.disconnectBtn.disabled = true;
        }
        
        // Update mode
        this.modeBadge.textContent = `Mode: ${this.isSender ? 'Sender' : 'Receiver'}`;
        this.toggleModeBtn.textContent = `Switch to ${this.isSender ? 'Receiver' : 'Sender'} Mode`;
    }

    addMessage(content, type = 'system', sender = '') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (type === 'system') {
            messageDiv.innerHTML = `<span class="system-text">${content}</span>`;
        } else {
            const timestamp = new Date().toLocaleTimeString();
            messageDiv.innerHTML = `
                <div class="message-header">
                    <span class="sender">${sender}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="message-content">${content}</div>
            `;
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    async connect() {
        this.localUsername = this.nameInput.value.trim();
        this.targetAddress = this.targetAddressInput.value.trim();
        
        if (!this.localUsername || !this.targetAddress) {
            this.addMessage('Please enter your name and target address', 'system');
            return;
        }
        
        try {
            this.addMessage('Connecting to signaling server...', 'system');
            await this.connectToSignalingServer();
            await this.initializeWebRTC();
            
            if (this.isSender) {
                this.addMessage('Creating offer as sender...', 'system');
                await this.createOffer();
            } else {
                this.addMessage('Waiting for offer as receiver...', 'system');
            }
            
        } catch (error) {
            console.error('Connection failed:', error);
            this.addMessage(`Connection failed: ${error.message}`, 'system');
        }
    }

    connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.signalingServerUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to signaling server');
                this.addMessage('Connected to signaling server', 'system');
                
                // Register with the signaling server
                this.ws.send(JSON.stringify({
                    type: 'register',
                    username: this.localUsername,
                    targetAddress: this.targetAddress,
                    mode: this.isSender ? 'sender' : 'receiver'
                }));
                
                resolve();
            };
            
            this.ws.onmessage = (event) => this.handleSignalingMessage(JSON.parse(event.data));
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(new Error('Failed to connect to signaling server'));
            };
            
            this.ws.onclose = () => {
                console.log('Disconnected from signaling server');
                this.addMessage('Disconnected from signaling server', 'system');
            };
        });
    }

    async initializeWebRTC() {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.pc = new RTCPeerConnection(config);
        
        // Handle ICE candidates
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate:', event.candidate);
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    targetAddress: this.targetAddress
                }));
            }
        };
        
        // Handle connection state changes
        this.pc.onconnectionstatechange = () => {
            console.log('Connection state:', this.pc.connectionState);
            this.addMessage(`Connection state: ${this.pc.connectionState}`, 'system');
            
            if (this.pc.connectionState === 'connected') {
                this.isConnected = true;
                this.updateUI();
                this.localAddress.textContent = `${this.localUsername}@${this.targetAddress}`;
                this.remoteAddress.textContent = 'Connected';
                this.addMessage('WebRTC connection established! You can now send messages.', 'system');
            } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                this.isConnected = false;
                this.updateUI();
            }
        };
        
        // Handle incoming data channel (for receiver)
        this.pc.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupDataChannel(channel);
        };
        
        // Create data channel (for sender)
        if (this.isSender) {
            this.dataChannel = this.pc.createDataChannel('messages', {
                ordered: true
            });
            this.setupDataChannel(this.dataChannel);
        }
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        
        channel.onopen = () => {
            console.log('Data channel opened');
            this.addMessage('Data channel opened - ready to send messages!', 'system');
            this.isConnected = true;
            this.updateUI();
        };
        
        channel.onmessage = (event) => {
            console.log('Received message:', event.data);
            const data = JSON.parse(event.data);
            this.addMessage(data.content, 'received', data.sender);
        };
        
        channel.onclose = () => {
            console.log('Data channel closed');
            this.addMessage('Data channel closed', 'system');
            this.isConnected = false;
            this.updateUI();
        };
        
        channel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.addMessage('Data channel error', 'system');
        };
    }

    async createOffer() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        
        this.ws.send(JSON.stringify({
            type: 'offer',
            offer: offer,
            targetAddress: this.targetAddress
        }));
        
        console.log('Offer sent');
        this.addMessage('Offer sent to peer', 'system');
    }

    async handleSignalingMessage(message) {
        console.log('Received signaling message:', message);
        
        switch (message.type) {
            case 'offer':
                if (!this.isSender) {
                    await this.pc.setRemoteDescription(message.offer);
                    const answer = await this.pc.createAnswer();
                    await this.pc.setLocalDescription(answer);
                    
                    this.ws.send(JSON.stringify({
                        type: 'answer',
                        answer: answer,
                        targetAddress: this.targetAddress
                    }));
                    
                    this.addMessage('Answer sent to peer', 'system');
                }
                break;
                
            case 'answer':
                if (this.isSender) {
                    await this.pc.setRemoteDescription(message.answer);
                    this.addMessage('Answer received from peer', 'system');
                }
                break;
                
            case 'ice-candidate':
                await this.pc.addIceCandidate(message.candidate);
                console.log('ICE candidate added');
                break;
                
            case 'error':
                this.addMessage(`Error: ${message.message}`, 'system');
                break;
        }
    }

    sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content || !this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }
        
        const message = {
            sender: this.localUsername,
            content: content,
            timestamp: new Date().toISOString()
        };
        
        this.dataChannel.send(JSON.stringify(message));
        this.addMessage(content, 'sent', this.localUsername);
        this.messageInput.value = '';
    }

    toggleMode() {
        if (this.isConnected) {
            this.addMessage('Cannot change mode while connected', 'system');
            return;
        }
        
        this.isSender = !this.isSender;
        this.updateUI();
        this.addMessage(`Switched to ${this.isSender ? 'Sender' : 'Receiver'} mode`, 'system');
    }

    disconnect() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.updateUI();
        this.localAddress.textContent = 'Not connected';
        this.remoteAddress.textContent = 'Not connected';
        this.addMessage('Disconnected', 'system');
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.messenger = new WebRTCMessenger();
});
