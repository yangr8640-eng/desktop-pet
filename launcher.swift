import Foundation

// This is an optional launcher for background/daemon execution.
// The standard way to launch is: npm start
// Resolve project directory relative to this script's location
let projectDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
let logFile = "/tmp/desktop-pet.log"

freopen(logFile, "w", stderr)
freopen(logFile, "w", stdout)

print("Launcher started \(Date())")

// Kill old instances
let killTask = Process()
killTask.launchPath = "/usr/bin/pkill"
killTask.arguments = ["-9", "-f", "electron"]
killTask.launch()
killTask.waitUntilExit()
print("Killed old instances")
Thread.sleep(forTimeInterval: 1.0)

var env = ProcessInfo.processInfo.environment
env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:" + (env["PATH"] ?? "")
env.removeValue(forKey: "ELECTRON_RUN_AS_NODE")

// Run exactly like "npm start" does: unset ELECTRON_RUN_AS_NODE && electron .
// Using zsh to get proper process group isolation so electron survives launcher exit
let task = Process()
task.launchPath = "/bin/zsh"
task.arguments = ["-c", "cd \"\(projectDir)\" && unset ELECTRON_RUN_AS_NODE && PATH=\"/usr/local/bin:/opt/homebrew/bin:$PATH\" \"\(projectDir)/node_modules/.bin/electron\" ."]
task.environment = env

print("Launching electron via zsh...")

do {
    try task.run()
    print("Launched")
} catch {
    print("Error: \(error)")
}

exit(0)
