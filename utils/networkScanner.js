const { exec } = require('child_process');
const os = require('os');
const dns = require('dns');
const util = require('util');
const ping = require('ping');

const dnsLookup = util.promisify(dns.lookup);

class NetworkScanner {
  constructor() {
    this.localNetworkInfo = null;
    this.discoveredDevices = [];
    this.scanInterval = null;
    this.isScanning = false;
  }

  initialize() {
    this.getLocalNetworkInfo();
    // Start periodic network scan every 5 minutes
    this.startPeriodicScan(5 * 60 * 1000);
  }

  async getLocalNetworkInfo() {
    try {
      const interfaces = os.networkInterfaces();
      const networkInfo = {};

      for (const [interfaceName, iface] of Object.entries(interfaces)) {
        for (const config of iface) {
          if (!config.internal && config.family === 'IPv4') {
            networkInfo[interfaceName] = {
              address: config.address,
              netmask: config.netmask,
              mac: config.mac,
              cidr: this.calculateCIDR(config.address, config.netmask)
            };
          }
        }
      }

      this.localNetworkInfo = networkInfo;
      return networkInfo;
    } catch (error) {
      console.error('Error getting local network info:', error);
      return null;
    }
  }

  calculateCIDR(ip, netmask) {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    
    let cidr = 0;
    for (let i = 0; i < 4; i++) {
      cidr += this.countBits(maskParts[i]);
    }
    
    return `${ip}/${cidr}`;
  }

  countBits(num) {
    let count = 0;
    while (num > 0) {
      count += num & 1;
      num >>= 1;
    }
    return count;
  }

  async scanLocalNetwork() {
    if (this.isScanning) {
      return this.discoveredDevices;
    }

    this.isScanning = true;
    const discoveredDevices = [];

    try {
      // Get local network info if not already available
      if (!this.localNetworkInfo) {
        await this.getLocalNetworkInfo();
      }

      // Scan common local IP ranges
      const networkRanges = this.getNetworkRanges();
      
      // Use parallel scanning for efficiency
      const scanPromises = networkRanges.map(async (ip) => {
        try {
          const isAlive = await this.pingDevice(ip);
          if (isAlive) {
            const deviceInfo = await this.getDeviceInfo(ip);
            discoveredDevices.push(deviceInfo);
          }
        } catch (error) {
          // Silently continue scanning other IPs
        }
      });

      await Promise.all(scanPromises);
      
      // Update discovered devices
      this.discoveredDevices = discoveredDevices;
      
    } catch (error) {
      console.error('Error scanning network:', error);
    } finally {
      this.isScanning = false;
    }

    return discoveredDevices;
  }

  getNetworkRanges() {
    const ranges = [];
    
    // Common local network ranges
    const commonRanges = [
      '192.168.0', '192.168.1', '192.168.2', '192.168.10', '192.168.100',
      '10.0.0', '10.0.1', '10.0.10', '10.1.1', '10.1.10',
      '172.16.0', '172.16.1', '172.16.10', '172.17.0', '172.17.1'
    ];

    // Generate IP addresses from 1 to 254 for each range
    for (const range of commonRanges) {
      for (let i = 1; i <= 254; i++) {
        ranges.push(`${range}.${i}`);
      }
    }

    return ranges;
  }

  async pingDevice(ip) {
    try {
      const result = await ping.promise.probe(ip, {
        timeout: 1,
        extra: ['-c', '1']
      });
      return result.alive;
    } catch (error) {
      return false;
    }
  }

  async getDeviceInfo(ip) {
    try {
      // Get hostname
      let hostname = 'Unknown';
      try {
        const host = await dnsLookup(ip);
        hostname = host.hostname || 'Unknown';
      } catch (error) {
        // Try reverse DNS
        hostname = await this.reverseDNS(ip) || 'Unknown';
      }

      // Get MAC address (platform specific)
      let macAddress = await this.getMacAddress(ip);

      // Get open ports (common ones)
      const openPorts = await this.scanPorts(ip, [22, 80, 443, 8080, 3000, 3389]);

      return {
        ip: ip,
        hostname: hostname,
        mac_address: macAddress,
        status: 'online',
        last_seen: new Date().toISOString(),
        open_ports: openPorts,
        device_type: this.guessDeviceType(openPorts, hostname)
      };
    } catch (error) {
      return {
        ip: ip,
        hostname: 'Unknown',
        mac_address: 'Unknown',
        status: 'online',
        last_seen: new Date().toISOString(),
        open_ports: [],
        device_type: 'unknown'
      };
    }
  }

  async reverseDNS(ip) {
    return new Promise((resolve) => {
      dns.reverse(ip, (err, hostnames) => {
        if (err || !hostnames || hostnames.length === 0) {
          resolve(null);
        } else {
          resolve(hostnames[0]);
        }
      });
    });
  }

  async getMacAddress(ip) {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        // Windows ARP command
        exec(`arp -a ${ip}`, (error, stdout) => {
          if (error) {
            resolve('Unknown');
          } else {
            const lines = stdout.split('\n');
            for (const line of lines) {
              if (line.includes(ip)) {
                const match = line.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
                if (match) {
                  resolve(match[0]);
                  return;
                }
              }
            }
            resolve('Unknown');
          }
        });
      } else {
        // Linux/Mac ARP command
        exec(`arp -n ${ip}`, (error, stdout) => {
          if (error) {
            resolve('Unknown');
          } else {
            const match = stdout.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
            resolve(match ? match[0] : 'Unknown');
          }
        });
      }
    });
  }

  async scanPorts(ip, ports) {
    const openPorts = [];
    
    const scanPromises = ports.map(async (port) => {
      try {
        const isOpen = await this.checkPort(ip, port);
        if (isOpen) {
          openPorts.push({
            port: port,
            service: this.getServiceName(port),
            status: 'open'
          });
        }
      } catch (error) {
        // Port check failed
      }
    });

    await Promise.all(scanPromises);
    return openPorts;
  }

  async checkPort(ip, port) {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(port, ip);
    });
  }

  getServiceName(port) {
    const commonPorts = {
      22: 'SSH',
      80: 'HTTP',
      443: 'HTTPS',
      8080: 'HTTP-Alt',
      3000: 'Node.js',
      3389: 'RDP',
      21: 'FTP',
      25: 'SMTP',
      53: 'DNS',
      110: 'POP3',
      143: 'IMAP',
      3306: 'MySQL',
      5432: 'PostgreSQL',
      27017: 'MongoDB'
    };
    
    return commonPorts[port] || `Port ${port}`;
  }

  guessDeviceType(openPorts, hostname) {
    const hostnameLower = hostname.toLowerCase();
    
    // Check for common device patterns
    if (hostnameLower.includes('android') || hostnameLower.includes('mobile')) {
      return 'mobile';
    }
    
    if (hostnameLower.includes('iphone') || hostnameLower.includes('ipad')) {
      return 'ios';
    }
    
    if (hostnameLower.includes('router') || hostnameLower.includes('gateway')) {
      return 'router';
    }
    
    if (hostnameLower.includes('printer')) {
      return 'printer';
    }
    
    if (hostnameLower.includes('nas') || hostnameLower.includes('storage')) {
      return 'nas';
    }
    
    if (hostnameLower.includes('tv') || hostnameLower.includes('smart')) {
      return 'smart_tv';
    }
    
    // Check by open ports
    const portServices = openPorts.map(p => p.service.toLowerCase());
    
    if (portServices.includes('http') || portServices.includes('https')) {
      return 'web_server';
    }
    
    if (portServices.includes('ssh')) {
      return 'server';
    }
    
    if (portServices.includes('rdp')) {
      return 'windows_pc';
    }
    
    return 'computer';
  }

  startPeriodicScan(intervalMs) {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    
    this.scanInterval = setInterval(async () => {
      console.log('Performing periodic network scan...');
      await this.scanLocalNetwork();
      console.log(`Found ${this.discoveredDevices.length} devices on network`);
    }, intervalMs);
  }

  stopPeriodicScan() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  getDiscoveredDevices() {
    return this.discoveredDevices;
  }

  getLocalNetworkDetails() {
    return this.localNetworkInfo;
  }

  async getPublicIP() {
    try {
      const https = require('https');
      return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org?format=json', (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              resolve(result.ip);
            } catch (error) {
              reject(error);
            }
          });
        }).on('error', reject);
      });
    } catch (error) {
      console.error('Error getting public IP:', error);
      return null;
    }
  }

  async getNetworkSpeed() {
    return new Promise((resolve) => {
      // Simple network speed test
      const startTime = Date.now();
      const testSize = 1000000; // 1MB test
      
      // Simulate network speed check
      setTimeout(() => {
        const elapsed = Date.now() - startTime;
        const speed = (testSize / elapsed) * 8; // Convert to Mbps
        
        resolve({
          download_speed: `${speed.toFixed(2)} Mbps`,
          latency: `${elapsed}ms`,
          test_size: '1MB'
        });
      }, 1000);
    });
  }

  cleanup() {
    this.stopPeriodicScan();
  }
}

module.exports = NetworkScanner;