const MAN = {
  backup:
    "Download a backup of the daemon's configuration, or restore one — served by hqplayerd's own /backup and /restore routes.",
};

// Page: engine identity (GetInfo / GetLicense, v1 About card; values from the repo's 6.0.4 GetInfo fixture) +
// Backup / restore (v1 BackupRestoreRow), then About HQPTuner (owner copy, v1 SystemTab.js).
export const ABOUT = {
  rows: [
    ["Product", "Signalyst HQPlayer Embedded"],
    ["Version", "6.0.4"],
    ["Engine", "6.0.4"],
    ["Licensed", "TRUE"],
    ["Platform", "Linux"],
  ],
  backup: MAN.backup,
  app: "2.0.0",
  prose: [
    "HQPTuner is a project by user oh shit, gorillas! to bring out the untapped UX potential of HQPlayer Embedded.",
    "Most credit goes to Jussi Laako/Signalyst. I'm just plugging into what he does and trying to make it easy and pretty. Thanks, Jussi!",
    [
      'HQPTuner is free and always will be. If it enhances your audio experience, then it\'s done its job and a simple "thank you" is all the payment I need. That said, if you really want your specific "thank you" to be financial, I won\'t stop you from ',
      { a: "buying me a coffee", href: "https://ko-fi.com/ohshitgorillas" },
      ". Just don't say I strong-armed you into it ;)",
    ],
  ],
};
