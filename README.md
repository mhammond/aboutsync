# About Sync

This addon shows information about your Sync account, including showing all
server data for your account. It is designed primarily for Sync developers, or
advanced users who would like some insights into their Sync data.

Once installed, you can either select "About Sync" from the tools menu, or
just type about:sync into the URL bar.

The source code is at https://github.com/mhammond/aboutsync and pull requests
are welcome!

# Development

The easiest way to develop/debug this is:

* First time setup:
    * Clone the git repo locally.
    * Run `npm install` from a command prompt when inside the repo.
* From a command prompt, run `npm run dev` to start watching
  files in `src` for changes.
* In about:debugging, Load the extension by selecting the
  `chrome.manifest` file.
* Open `about:sync` (there's also an "About Sync" entry created in the
  "Tools" menu, which does exactly that)
* When using the addon this way, you can make changes to the
  HTML/CSS/JS and press the refresh button in the `about:debugging`
  panel. It will be picked up automatically.

Other notes:
* To see verbose debug messages from bootstrap.js, create a boolean preference
  "extensions.aboutsync.verbose" to true - message will be sent to the browser
  console. Note that console.log etc can be used in the "data" JS.
