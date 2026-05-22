#!/usr/bin/ruby
# Optional launcher for running the desktop pet as a background daemon.
# The standard way to launch is: npm start
ENV['PATH'] = "/usr/local/bin:#{ENV['PATH']}"

# Kill old instances
`pkill -9 -f electron 2>/dev/null`
sleep 1

# Fork and daemonize, redirect output away from Terminal
pid = Process.fork do
  Process.setsid
  $stdout.reopen("/tmp/desktop-pet.log", "w")
  $stderr.reopen("/tmp/desktop-pet.log", "w")
  Dir.chdir(File.dirname(__FILE__))
  exec("npm", "start")
end

Process.detach(pid)
