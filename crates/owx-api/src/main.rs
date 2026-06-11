fn main() {
    if let Err(error) = owx_api::run_cli(
        std::env::args().skip(1),
        std::io::stdout(),
        std::io::stderr(),
    ) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
