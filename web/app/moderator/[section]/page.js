import {redirect} from "next/navigation";
export default async function ModeratorSection({params}){const {section}=await params;redirect("/park#moderator/"+encodeURIComponent(section));}
