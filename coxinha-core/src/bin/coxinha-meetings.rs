#[path = "meetings/processing.rs"]
mod processing;
use anyhow::{bail, Context, Result};
use coxinha_core::{
    capture::{Recording, Track},
    store::Store,
};
use std::{
    io::BufRead,
    path::Path,
    time::{Duration, Instant},
};

fn argument(args: &[String], index: usize) -> Result<&str> {
    args.get(index)
        .map(String::as_str)
        .context("missing argument; run help")
}
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str).unwrap_or("help") {
        "help"=>println!("coxinha-meetings import-audio ROOT TITLE WAV | import-wav ROOT TITLE MIC_WAV OUTPUT_WAV | process ROOT MEETING CONFIG_JSON | report ROOT MEETING | sources | init ROOT | list ROOT | smoke ROOT | recover ROOT MEETING | backup ROOT DEST | export ROOT MEETING DEST | capture ROOT MIC MONITOR SECONDS\nCapture is explicit, local and uncalibrated. stdin commands: pause, resume, stop. No default device fallback.\nFeature stt-whisper: transcribe MODEL WAV (PCM16 mono 16kHz)."),
        "process"=>processing::process(argument(&args,1)?,argument(&args,2)?,argument(&args,3)?)?,
        "import-audio"=>println!("{}",Store::open(argument(&args,1)?)?.import_audio(argument(&args,2)?,Path::new(argument(&args,3)?))?),
        "recognition"=>println!("{}",serde_json::to_string_pretty(&Store::open(argument(&args,1)?)?.recognition(argument(&args,2)?)?)?),
        "import-wav"=>processing::import(argument(&args,1)?,argument(&args,2)?,argument(&args,3)?,argument(&args,4)?)?,
        "report"=>println!("{}",serde_json::to_string_pretty(&Store::open(argument(&args,1)?)?.processing_report(argument(&args,2)?)?)?),
        "sources"=>{
            #[cfg(target_os="linux")] println!("{}",serde_json::to_string_pretty(&coxinha_core::capture::list_sources()?)?);
            #[cfg(not(target_os="linux"))] bail!("native source adapter not implemented on this platform; hardware validation pending");
        },
        "init"=>{Store::open(argument(&args,1)?)?;println!("library initialized; no legacy import");},
        "list"=>println!("{}",serde_json::to_string_pretty(&Store::open(argument(&args,1)?)?.list_meetings()?)?),
        "smoke" | "smoke-hold"=>{
            let s=Store::open(argument(&args,1)?)?;let m=s.create_meeting("Synthetic capture smoke")?;
            let mut recording=Recording::start(&s,&m,"synthetic-mic","synthetic-output")?;
            for i in 0..50 {
                let at=(i+1)*20_000_000;
                if i==10{recording.pause(true,at)?;}else if i==20{recording.pause(false,at)?;}
                let mic:Vec<i16>=(0..960).map(|n|((n as f64*0.1).sin()*10000.0) as i16).collect();
                let output:Vec<i16>=mic.iter().map(|v|-v/2).collect();
                recording.write_block(Track::Mic,&mic,at)?;recording.write_block(Track::Output,&output,at+1_000_000)?;
            }
            if args[0]=="smoke-hold" {
                recording.checkpoint()?;
                recording.write_block(Track::Mic,&[7;960],2_000_000_000)?;
                recording.write_block(Track::Output,&[8;960],2_000_000_000)?;
                println!("{m}");
                std::io::Write::flush(&mut std::io::stdout())?;
                std::thread::sleep(Duration::from_secs(60));
            }
            println!("{}",serde_json::to_string_pretty(&recording.finish(&s,false)?)?);
        },
        "recover"=>{let s=Store::open(argument(&args,1)?)?;println!("{}",serde_json::to_string_pretty(&s.recover_capture(argument(&args,2)?)?)?);println!("recovered_jobs={}",s.recover_jobs()?);},
        "backup"=>Store::open(argument(&args,1)?)?.backup(Path::new(argument(&args,2)?))?,
        "export"=>Store::open(argument(&args,1)?)?.export_meeting(argument(&args,2)?,Path::new(argument(&args,3)?))?,
        "capture"=>{
            #[cfg(target_os="linux")] capture(&args)?;
            #[cfg(not(target_os="linux"))] bail!("Windows WASAPI adapter and hardware validation are pending; no fallback enabled");
        },
        #[cfg(feature="stt-whisper")]
        "transcribe"=>println!("{}",serde_json::to_string_pretty(&coxinha_core::whisper::transcribe_cpu(Path::new(argument(&args,1)?),Path::new(argument(&args,2)?))?)?),
        _=>bail!("unknown command; run help"),
    }
    Ok(())
}
#[cfg(target_os = "linux")]
fn capture(args: &[String]) -> Result<()> {
    let seconds: u64 = argument(args, 4)?.parse()?;
    anyhow::ensure!(
        (1..=14400).contains(&seconds),
        "duration must be 1..14400 seconds"
    );
    let store = Store::open(argument(args, 1)?)?;
    let meeting = store.create_meeting("Local capture")?;
    let mut capture = coxinha_core::capture::PulseCapture::start(
        &store,
        &meeting,
        argument(args, 2)?,
        argument(args, 3)?,
    )?;
    println!("meeting={meeting}; arrival-clock alignment only; hardware drift unmeasured");
    let (tx, rx) = std::sync::mpsc::sync_channel(8);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let start = Instant::now();
    let mut checkpoint = Instant::now();
    let mut interrupted = false;
    while start.elapsed() < Duration::from_secs(seconds) {
        if let Ok(command) = rx.try_recv() {
            match command.trim() {
                "pause" => capture.pause(true)?,
                "resume" => capture.pause(false)?,
                "stop" => break,
                _ => eprintln!("expected pause, resume or stop"),
            }
        }
        match capture.pump() {
            Ok(Some((track, peak))) => {
                if checkpoint.elapsed() >= Duration::from_secs(1) {
                    println!("track={track:?} peak={peak:.4}");
                    capture.recording.request_checkpoint()?;
                    checkpoint = Instant::now();
                }
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("capture interrupted: {error:#}");
                interrupted = true;
                break;
            }
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&capture.finish(&store, interrupted)?)?
    );
    if interrupted {
        bail!("capture failed; originals retained with interrupted state")
    }
    Ok(())
}
