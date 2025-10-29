'use strict';
import * as vscode from 'vscode';
import { AutoJsDebugServer, Device } from './autojs-debug';
import { ProjectTemplate, Project } from './project';

import * as fs from 'fs'
import * as path from "path";

let server = new AutoJsDebugServer(9317);
let recentDevice = null;
let statusBarItem: vscode.StatusBarItem;

server
  .on('connect', () => {
    updateStatusBar(true);
    let servers = server.getIPs().join(":" + server.getPort() + " or ") + ":" + server.getPort();
    let showQrcode = "Show QR code"
    vscode.window.showInformationMessage(`Auto.js Autox.js \r\n server running on ${servers}`, showQrcode).then((result) => {
      if (result === showQrcode) {
        vscode.commands.executeCommand("extension.showQrCode")
      }
    });
  })
  .on('connected', () => {
    updateStatusBar(true);
    vscode.window.showInformationMessage('Auto.js Server already running');
  })
  .on('disconnect', () => {
    updateStatusBar(false);
    vscode.window.showInformationMessage('Auto.js Server stopped');
  })
  .on('adb:tracking_start', () => {
    vscode.window.showInformationMessage(`ADB: Tracking start`);
  })
  .on('adb:tracking_started', () => {
    vscode.window.showInformationMessage(`ADB: Tracking already running`);
  })
  .on('adb:tracking_stop', () => {
    vscode.window.showInformationMessage(`ADB: Tracking stop`);
  })
  .on('adb:tracking_error', () => {
    vscode.window.showInformationMessage(`ADB: Tracking error`);
  })
  .on('new_device', (device: Device) => {
    let messageShown = false;
    let showMessage = () => {
      if (messageShown)
        return;
      vscode.window.showInformationMessage('New device attached: ' + device);
      messageShown = true;
    };
    setTimeout(showMessage, 1000);
    device.on('data:device_name', showMessage);
    // device.send("hello","打开连接");
  })
  .on('cmd', (cmd: String, url: String) => {
    switch (cmd) {
      case "save":
        extension.saveProject(url);
        break;
      case "rerun":
        extension.stopAll();
        setTimeout(function () {
          extension.run(url);
        }, 1000);
        break;
      default:
        break;
    }
  })
  .on('save_file', (filename: string, base64Content: string) => {
    vscode.window.showInformationMessage(`Received screenshot: ${filename}`);
    extension.saveFileFromDevice(filename, base64Content);
  })

function updateStatusBar(isRunning: boolean) {
  if (!statusBarItem) {
    return;
  }

  if (isRunning) {
    statusBarItem.text = "$(debug-start) Auto.JS: Running";
    statusBarItem.tooltip = "Auto.JS server is running. Click to stop.";
    statusBarItem.command = "extension.stopServer";
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = "$(debug-stop) Auto.JS: Stopped";
    statusBarItem.tooltip = "Auto.JS server is stopped. Click to start.";
    statusBarItem.command = "extension.startServer";
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

class Extension {
  private documentViewPanel: any = undefined;
  private qrCodeViewPanel: any = undefined;
  private documentCache: Map<string, string> = new Map<string, string>();

  showServerAddress() {
    let servers = server.getIPs().join(":" + server.getPort() + " or ") + ":" + server.getPort();
    vscode.window.showInformationMessage(`Auto.js Autox.js \r\n server running on ${servers}`)
  }

  showQrCode() {
    let ips = server.getIPs()
    if (ips.length == 1) {
      this.showQrcodeWebview(ips[0])
    } else {
      vscode.window.showQuickPick(ips)
        .then(ip => {
          this.showQrcodeWebview(ip)
        });
    }

  }

  private showQrcodeWebview(ip: string) {
    let url = `ws://${ip}:${server.getPort()}`
    if (!this.qrCodeViewPanel) {
      this.qrCodeViewPanel = vscode.window.createWebviewPanel(
        'Qr code',
        "Qr code",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
        }
      );
      this.qrCodeViewPanel.onDidDispose(() => {
        this.qrCodeViewPanel = undefined;
      },
        undefined,
        _context.subscriptions
      );
    }
    this.qrCodeViewPanel.webview.html = this.getQrCodeHtml(url)
  }

  private getQrCodeHtml(text: string): string {
    const icon = Extension.getVscodeResourceUrl(this.qrCodeViewPanel, "logo.png")
    const qrcodejs = Extension.getVscodeResourceUrl(this.qrCodeViewPanel, "assets/qrcode.js")
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR CODE</title>
</head>
<body>
    <div id="qrcode"></div>
    <script src="${qrcodejs}"></script>
    <script type="text/javascript">
        new QRCode(document.getElementById("qrcode"), {
            width: 200,
            height: 200,
            curtainWidth: 220,
            curtainHeight: 220,
            qrcodeOffsetX: 10,
            qrcodeOffsetY: 10,
            curtainBgColor: "white",
            text: "${text}",
            iconSrc: "${icon}",
            iconRadius: 10
        }
        )
    </script>
</body>
</html>`
  }

  static getVscodeResourceUrl(webviewPanel: any, relativePath: string): string {
    return webviewPanel.webview.asWebviewUri(
      vscode.Uri.file(path.join(_context.extensionPath, relativePath))
    );
  }

  openDocument() {
    if (this.documentViewPanel) {
      this.documentViewPanel.reveal((vscode.ViewColumn as any).Beside);
    } else {
      // 1.创建并显示Webview
      this.documentViewPanel = (vscode.window as any).createWebviewPanel(
        // 该webview的标识，任意字符串
        'Autox.js Document',
        // webview面板的标题，会展示给用户
        'Autox.js开发文档',
        // webview面板所在的分栏
        (vscode.ViewColumn as any).Beside,
        // 其它webview选项
        {
          // Enable scripts in the webview
          enableScripts: true,
          retainContextWhenHidden: true, // webview被隐藏时保持状态，避免被重置
        }
      );
      // Handle messages from the webview
      this.documentViewPanel.webview.onDidReceiveMessage(message => {
        // console.log('插件收到的消息：' + message.href);
        let href = message.href.substring(message.href.indexOf("\/electron-browser\/") + 18);
        // console.log("得到uri：" + href)
        this.loadDocument(href)
      }, undefined, _context.subscriptions);
      this.documentViewPanel.onDidDispose(() => {
        this.documentViewPanel = undefined;
      },
        undefined,
        _context.subscriptions
      );
    }
    try {
      // 默认加载首页
      this.loadDocument("http://doc.autoxjs.com/#/");
    } catch (e) {
      console.trace(e)
    }
  }

  private loadDocument(url) {
    try {
      let cache = this.documentCache.get(url);
      if (!cache) {
        cache = `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" name="viewport">
                    <meta content="portrait" name="x5-orientation">
                    <meta content="true" name="x5-fullscreen">
                    <meta content="portrait" name="screen-orientation">
                    <meta content="yes" name="full-screen">
                    <meta content="webkit" name="renderer">
                    <meta content="IE=Edge" http-equiv="X-UA-Compatible">
                    <title>微信读书</title>
                    <style>
                    html,body,iframe{
                        width:100%;
                        height:100%;
                        border:0;
                        overflow: hidden;
                    }
                    </style>
                </head>
                <body>
                    <iframe src="`+ url + `"/>
                </body>
                </html>`;
        this.documentCache.set(url, cache);
      }
      this.documentViewPanel.webview.html = cache;
    } catch (e) {
      console.trace(e);
    }
  }

  startServer() {
    server.listen();
  }

  stopServer() {
    server.disconnect();
  }

  startTrackADBDevices() {
    server.trackADBDevices()
  }

  stopTrackADBDevices() {
    server.stopTrackADBDevices()
  }

  startAllServer() {
    server.listen()
    server.trackADBDevices()
  }

  stopAllServer() {
    server.disconnect()
    server.stopTrackADBDevices()
  }

  async manuallyConnectADB() {
    let devices = await server.listADBDevices()
    let names = await Promise.all(devices.map(async (device) => {
      let adbDevice = server.adbClient.getDevice(device.id)
      let brand = await server.adbShell(adbDevice, "getprop ro.product.brand")
      let model = await server.adbShell(adbDevice, "getprop ro.product.model")
      return `${brand} ${model}: ${device.id}`
    }));
    vscode.window.showQuickPick(names)
      .then(name => {
        let device = devices[names.indexOf(name)]
        server.connectDevice(device.id)
      });
  }

  manuallyDisconnect() {
    let devices = server.devices
    let names = devices.map((device) => { return device.name + ": " + device.id })
    vscode.window.showQuickPick(names)
      .then(name => {
        let device = devices[names.indexOf(name)]
        server.getDeviceById(device.id).close()
      });
  }

  run(url?) {
    this.runOrRerun('run', url);
  }

  stop() {
    server.sendCommand('stop', {
      'id': vscode.window.activeTextEditor.document.fileName,
    });

  }

  stopAll() {
    server.sendCommand('stopAll');

  }

  rerun(url?) {
    this.runOrRerun('rerun', url);

  }

  runOrRerun(cmd, url?) {
    console.log("url-->", url);
    let text = "";
    let filename = null;
    if (url != null) {
      let uri = vscode.Uri.parse(url);
      filename = uri.fsPath;
      console.log("fileName-->", filename);
      try {
        text = fs.readFileSync(filename, 'utf8');
      } catch (error) {
        console.error(error);
      }
    } else {
      let editor = vscode.window.activeTextEditor;
      console.log("dfn", editor.document.fileName);
      filename = editor.document.fileName;
      text = editor.document.getText();
    }
    server.sendCommand(cmd, {
      'id': filename,
      'name': filename,
      'script': text
    });
  }

  runOnDevice() {
    this.selectDevice(device => this.runOn(device));
  }

  selectDevice(callback) {
    let devices: Array<Device> = server.devices;
    if (recentDevice) {
      let i = devices.indexOf(recentDevice);
      if (i > 0) {
        devices = devices.slice(0);
        devices[i] = devices[0];
        devices[0] = recentDevice;
      }
    }
    let names = devices.map(device => device.toString());
    vscode.window.showQuickPick(names)
      .then(select => {
        let device = devices[names.indexOf(select)];
        recentDevice = device;
        callback(device);
      });
  }

  runOn(target: AutoJsDebugServer | Device) {
    let editor = vscode.window.activeTextEditor;
    target.sendCommand('run', {
      'id': editor.document.fileName,
      'name': editor.document.fileName,
      'script': editor.document.getText()
    })

  }

  save(url?) {
    this.saveTo(server, url);
  }

  saveToDevice() {
    this.selectDevice(device => this.saveTo(device));
  }

  saveTo(target: AutoJsDebugServer | Device, url?) {
    let text = "";
    let filename: string;
    if (null != url) {
      let uri = vscode.Uri.parse(url);
      filename = uri.fsPath;
      console.log("fileName-->", filename);
      try {
        text = fs.readFileSync(filename, 'utf8');
      } catch (error) {
        console.error(error);
      }
    } else {
      let editor = vscode.window.activeTextEditor;
      filename = editor.document.fileName;
      text = editor.document.getText();
    }
    console.log("url-->", filename);
    try {
      target.sendCommand('save', {
        'id': filename,
        'name': filename,
        'script': text
      })
    } catch (error) {
      console.error(error);
    }


  }

  newProject() {
    vscode.window.showOpenDialog({
      'canSelectFiles': false,
      'canSelectFolders': true,
      'openLabel': '新建到这里'
    }).then(uris => {
      if (!uris || uris.length == 0) {
        return;
      }
      return new ProjectTemplate(uris[0])
        .build();
    }).then(uri => {
      vscode.commands.executeCommand("vscode.openFolder", uri);
    });
  }

  runProject() {
    this.sendProjectCommand("run_project");
  }

  saveProject(url?) {
    this.sendProjectCommand("save_project", url);
  }  

  sendProjectCommand(command: string, url?) {
    console.log("url-->", url);
    let folder = null;
    if (url == null) {
      let folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length == 0) {
        vscode.window.showInformationMessage("Please open a project folder");
        return null;
      }
      folder = folders[0].uri;
    } else {
      folder = vscode.Uri.parse(url);
    }
    console.log("folder-->", folder);
    if (!server.project || server.project.folder != folder) {
      server.project && server.project.dispose();
      server.project = new Project(folder);
    }
    if (!server.project || server.project.folder != folder) {
      server.project && server.project.dispose();
      server.project = new Project(folder);
    }
    server.sendProjectCommand(folder.fsPath, command);
  }

  captureScreen() {
    // Get server IP address
    let serverIp = server.getIPAddress();
    let serverPort = server.getPort();

    // Generate filename with timestamp
    let timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    let filename = `screenshots/screenshot_${timestamp}.png`;

    // Create the screenshot script that will run on device
    let screenshotScript = `
console.log("Starting screenshot capture...");

// Request screen capture permission
console.log("Requesting screen capture permission...");
if (!requestScreenCapture()) {
  console.error("Failed to request screen capture permission");
  toast("请求截图权限失败");
  exit();
}
console.log("Screen capture permission granted");

// Capture screenshot
console.log("Capturing screenshot...");
let img = captureScreen();
if (!img) {
  console.error("Failed to capture screenshot");
  toast("截图失败");
  exit();
}
console.log("Screenshot captured successfully");

// Convert to base64
console.log("Converting image to base64...");
let base64 = images.toBase64(img, "png", 100);
if (!base64) {
  console.error("Failed to convert image to base64");
  toast("图片转换失败");
  img.recycle();
  exit();
}
console.log("Image converted successfully, size: " + base64.length + " characters");

// Send to server
let serverUrl = "http://${serverIp}:${serverPort}/save";
console.log("Sending to server: " + serverUrl);
try {
  let response = http.postJson(serverUrl, {
    filename: "${filename}",
    content: base64
  });
  
  console.log("Server response status: " + response.statusCode);
  if (response.statusCode == 200) {
    console.log("Screenshot saved: ${filename}");
    toast("截图已保存");
  } else {
    console.error("Failed to save screenshot: " + response.statusCode);
    toast("保存失败");
  }
} catch (error) {
  console.error("Failed to send to server: " + error);
  toast("发送失败: " + error);
}

// Release image
img.recycle();
console.log("Screenshot process completed");
`;

    // Send command to run the script
    server.sendCommand('run', {
      'id': 'CaptureScreen.js',
      'name': 'CaptureScreen.js',
      'script': screenshotScript
    });

    vscode.window.showInformationMessage('Capturing screenshot...');
  }

  saveFileFromDevice(filename: string, base64Content: string) {
    let folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length == 0) {
      vscode.window.showErrorMessage("Please open a workspace folder");
      return;
    }

    let workspaceRoot = folders[0].uri.fsPath;
    let filePath = path.join(workspaceRoot, filename);
    let dirPath = path.dirname(filePath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Decode base64 and save file
    try {
      let buffer = Buffer.from(base64Content, 'base64');
      fs.writeFileSync(filePath, buffer as Uint8Array);
      vscode.window.showInformationMessage(`Screenshot saved: ${filename}`);

      // Open the file automatically
      let fileUri = vscode.Uri.file(filePath);
      vscode.commands.executeCommand('vscode.open', fileUri);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save file: ${error.message}`);
    }
  }
}


export let _context: vscode.ExtensionContext;
let extension = new Extension();
const commands = ['startAllServer', 'stopAllServer', 'startServer', 'stopServer', 'startTrackADBDevices',
  'stopTrackADBDevices', 'manuallyConnectADB', 'manuallyDisconnect', 'showServerAddress', 'showQrCode', 'openDocument', 'run', 'runOnDevice',
  'stop', 'stopAll', 'rerun', 'save', 'saveToDevice', 'newProject', 'runProject', 'saveProject', 'captureScreen'];


export function activate(context: vscode.ExtensionContext) {
  console.log('extension "Autox.js-VSCode-Extension " is now active.');

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  updateStatusBar(false); // Initialize as stopped
  context.subscriptions.push(statusBarItem);

  commands.forEach((command) => {
    let action: Function = extension[command];
    context.subscriptions.push(vscode.commands.registerCommand('extension.' + command, action.bind(extension)));
    _context = context;
    // @ts-ignore
    console.log(context.extension.packageJSON.version)
  })
}

export function deactivate() {
  server.disconnect();
}

