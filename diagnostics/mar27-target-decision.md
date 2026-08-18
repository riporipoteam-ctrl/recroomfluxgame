# March 27 2020 production candidate

Target build: 4802887
Manifest: 2539899194395389618
Archive: https://archive.recagain.site/download/2020-03-27T06-58-55Z

Reason: March 27's only non-default ICertificateVerifyer class is TiltCheck.BCTiltChecker; the obfuscated RecNet-specific verifier seen from April 8 2020 through May 2022 is absent. The exact metadata contains one https://ns.rec.net/?v=2 bootstrap literal and metadata version 24. TLS verification remains enabled; no certificate-verifier or EAC bypass is used.
