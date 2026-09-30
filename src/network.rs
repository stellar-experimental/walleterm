//! The Stellar CLI built-in networks. The passphrase is the signing identity. The names are display text.

/// One built-in Stellar network.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Network {
    /// The Stellar CLI name, such as `testnet`.
    pub name: &'static str,
    /// The SEP-43 name: the Stellar SDK `Networks` key, such as `TESTNET`.
    pub sep43: &'static str,
    /// The name inside a sentence, such as "Stellar testnet".
    pub label: &'static str,
    pub passphrase: &'static str,
}

pub const TESTNET: &str = "Test SDF Network ; September 2015";

/// The Stellar CLI built-in networks, with the passphrases of the Stellar SDK `Networks` values.
pub const BUILT_IN: [Network; 4] = [
    Network { name: "testnet", sep43: "TESTNET", label: "Stellar testnet", passphrase: TESTNET },
    Network {
        name: "futurenet",
        sep43: "FUTURENET",
        label: "Stellar futurenet",
        passphrase: "Test SDF Future Network ; October 2022",
    },
    Network {
        name: "local",
        sep43: "STANDALONE",
        label: "a local Stellar network",
        passphrase: "Standalone Network ; February 2017",
    },
    Network {
        name: "mainnet",
        sep43: "PUBLIC",
        label: "Stellar mainnet",
        passphrase: "Public Global Stellar Network ; September 2015",
    },
];

/// The default network of `walleterm tunnel` and the only network of `walleterm demo`.
pub const DEFAULT: Network = BUILT_IN[0];

/// The built-in network with this Stellar CLI name.
pub fn named(name: &str) -> Option<Network> {
    BUILT_IN.into_iter().find(|n| n.name == name)
}

/// The built-in network with this exact passphrase.
pub fn of(passphrase: &str) -> Option<Network> {
    BUILT_IN.into_iter().find(|n| n.passphrase == passphrase)
}

/// The networks that `walleterm tunnel` serves. Mainnet waits for approval in the tunnel terminal.
pub fn tunnel(name: &str) -> Option<Network> {
    named(name).filter(|n| n.name != "mainnet")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn built_in_networks_match_their_documented_network_ids() {
        // docs/NETWORKS.md lists each network ID: SHA-256 of the passphrase.
        let ids = [
            ("testnet", "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472"),
            ("futurenet", "a3a1c6a78286713e29be0e9785670fa838d13917cd8eaeb4a3579ff1debc7fd5"),
            ("local", "baefd734b8d3e48472cff83912375fedbc7573701912fe308af730180f97d74a"),
            ("mainnet", "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979"),
        ];
        for (name, id) in ids {
            let network = named(name).unwrap();
            assert_eq!(crate::util::hex(&crate::util::sha256(network.passphrase.as_bytes())), id, "{name}");
            assert_eq!(of(network.passphrase), Some(network));
        }
        assert_eq!(DEFAULT.passphrase, TESTNET);
        assert_eq!(of("Walleterm ; offline"), None);
    }

    #[test]
    fn the_tunnel_serves_the_test_networks_only() {
        for name in ["testnet", "futurenet", "local"] {
            assert_eq!(tunnel(name).map(|n| n.name), Some(name));
        }
        for name in ["mainnet", "pubnet", "public", "TESTNET", "", "custom"] {
            assert_eq!(tunnel(name), None, "{name}");
        }
    }
}
