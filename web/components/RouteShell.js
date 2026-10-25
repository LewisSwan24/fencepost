"use client";
import {usePathname} from 'next/navigation';
import NameGate from './NameGate';
import styles from "../app/layout.module.css";
export default function RouteShell({children}){
 const path=usePathname();
 // The public park entry point must not request a name or create an account.
 if(path==='/'||path==='/park')return <div style={{maxWidth:1080,margin:'auto',minHeight:'100dvh'}}>{children}</div>;
 return <div className={styles.shell}><NameGate>{children}</NameGate></div>;
}
