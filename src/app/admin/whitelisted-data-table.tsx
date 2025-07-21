"use client"
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { addUsersToWhitelistAction as addUsersToWhitelist, addUsersToAdminAction as addUsersToAdmin } from "@/app/actions/serverActions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { removeFromWhitelistAction as removeFromWhitelist, removeFromAdminAction as removeFromAdmin } from "@/app/actions/serverActions";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import SearchBar from "./UserSearch";
import { ArrowUpDown } from "lucide-react";


// -----------------------------
// Dialog helpers
// -----------------------------

export function AddWhitelistDialog() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const router = useRouter();
    const [users, setUsers] = useState<string[]>([]);
    const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error", message: string, isLoading: boolean }>({ status: "success", message: "", isLoading: false });
    const [query, setQuery] = useState('');

    async function addToWhitelist() {
        setUploadStatus({ status: "success", message: "", isLoading: true });
        const resp = await addUsersToWhitelist(users);
        if (resp.status === "success") {
            router.refresh();
            setIsDialogOpen(false);
            setUsers([]);
        }
        setUploadStatus({ status: resp.status as "success" | "error", message: resp.message, isLoading: false });
    }

    function removeFromUsers(user: string) {
        setUsers(users.filter((u) => u !== user));
    }

    function setUserWithFilter(user: string) {
        setUsers([...users.filter((u) => u !== user), user]);
    }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Add User to Whitelist</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] text-black">
                <DialogHeader>
                    <DialogTitle>Add Users to Whitelist</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-gray-500">Insert wallet address or username</p>
                <div className="space-y-4">
                    <SearchBar setUsers={(user:string) => setUserWithFilter(user)} query={query} setQuery={setQuery} />
                    <div>
                        {users.map((user) => <Button variant="outline" onClick={() => removeFromUsers(user)} key={user}>{user} <X className="w-4 h-4 ml-1" /></Button>)} 
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={() => addToWhitelist()}>Save changes {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="whyyyyy" /> : ""}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Dialog for adding users to admin role
export function AddAdminDialog() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const router = useRouter();
    const [users, setUsers] = useState<string[]>([]);
    const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error", message: string, isLoading: boolean }>({ status: "success", message: "", isLoading: false });
    const [query, setQuery] = useState('');

    async function addToAdmin() {
        setUploadStatus({ status: "success", message: "", isLoading: true });
        const resp = await addUsersToAdmin(users);
        if (resp.status === "success") {
            router.refresh();
            setIsDialogOpen(false);
            setUsers([]);
        }
        setUploadStatus({ status: resp.status as "success" | "error", message: resp.message, isLoading: false });
    }

    function removeFromUsers(user: string) {
        setUsers(users.filter((u) => u !== user));
    }

    function setUserWithFilter(user: string) {
        setUsers([...users.filter((u) => u !== user), user]);
    }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Add User to Admin</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] text-black">
                <DialogHeader>
                    <DialogTitle>Add Users to Admin</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-gray-500">Insert wallet address or username</p>
                <div className="space-y-4">
                    <SearchBar setUsers={(user:string) => setUserWithFilter(user)} query={query} setQuery={setQuery} />
                    <div>
                        {users.map((user) => <Button variant="outline" onClick={() => removeFromUsers(user)} key={user}>{user} <X className="w-4 h-4 ml-1" /></Button>)} 
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={() => addToAdmin()}>Save changes {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="whyyyyy" /> : ""}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Dialog to remove by search from whitelist
export function RemoveWhitelistDialog() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const router = useRouter();
    const [users, setUsers] = useState<string[]>([]);
    const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error", message: string, isLoading: boolean }>({ status: "success", message: "", isLoading: false });
    const [query, setQuery] = useState('');

    async function removeFromWhitelistBySearch() {
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await removeFromWhitelist(users);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
        setIsDialogOpen(false);
        setUsers([]);
    }

    function removeFromUsers(user: string) { setUsers(users.filter((u) => u !== user)); }
    function setUserWithFilter(user: string) { setUsers([...users.filter((u) => u !== user), user]); }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Remove User from Whitelist</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] text-black">
                <DialogHeader><DialogTitle>Remove Users from Whitelist</DialogTitle></DialogHeader>
                <p className="text-sm text-gray-500">Insert wallet address or username</p>
                <div className="space-y-4">
                    <SearchBar setUsers={(user:string)=>setUserWithFilter(user)} query={query} setQuery={setQuery} />
                    <div>{users.map((u)=><Button variant="outline" onClick={()=>removeFromUsers(u)} key={u}>{u} <X className="w-4 h-4 ml-1" /></Button>)}</div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={removeFromWhitelistBySearch}>Save changes {uploadStatus.isLoading && <img className="w-4 h-4" src="/spinner.svg" alt="loading"/>}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Dialog to remove by search from admin
export function RemoveAdminDialog() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const router = useRouter();
    const [users, setUsers] = useState<string[]>([]);
    const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error", message: string, isLoading: boolean }>({ status: "success", message: "", isLoading: false });
    const [query, setQuery] = useState('');

    async function removeFromAdminBySearch() {
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await removeFromAdmin(users);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
        setIsDialogOpen(false);
        setUsers([]);
    }
    function removeFromUsers(user: string) { setUsers(users.filter((u)=>u!==user)); }
    function setUserWithFilter(user: string) { setUsers([...users.filter((u)=>u!==user), user]); }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="outline">Remove User from Admin</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] text-black">
                <DialogHeader><DialogTitle>Remove Users from Admin</DialogTitle></DialogHeader>
                <p className="text-sm text-gray-500">Insert wallet address or username</p>
                <div className="space-y-4">
                    <SearchBar setUsers={(user:string)=>setUserWithFilter(user)} query={query} setQuery={setQuery} />
                    <div>{users.map((u)=> <Button variant="outline" onClick={()=>removeFromUsers(u)} key={u}>{u} <X className="w-4 h-4 ml-1" /></Button>)}</div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={removeFromAdminBySearch}>Save changes {uploadStatus.isLoading && <img className="w-4 h-4" src="/spinner.svg" alt="loading"/>}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
}

export default function WhitelistedDataTable<TData, TValue>({
    columns,
    data,
}: DataTableProps<TData, TValue>) {
    const router = useRouter();
    const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [uploadStatus, setUploadStatus] = useState<{ status: "success" | "error", message: string, isLoading: boolean }>({ status: "success", message: "", isLoading: false });
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        onSortingChange: setSorting,
        getSortedRowModel: getSortedRowModel(),
        onRowSelectionChange: setRowSelection,
        state: {
            sorting,
            rowSelection,
        },
    })

    type TDataWithId = TData & { id: string };

    async function commitRemoveFromWhitelist() {
        const selectedUsers = table.getFilteredSelectedRowModel().rows.map((row) => row.original as TDataWithId).map((row) => row.id);
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await removeFromWhitelist(selectedUsers);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
    }

    async function commitRemoveFromAdmin() {
        const selectedUsers = table.getFilteredSelectedRowModel().rows.map((row) => row.original as TDataWithId).map((row) => row.id);
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await removeFromAdmin(selectedUsers);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
    }

    async function commitAddSelectedToWhitelist() {
        const wallets = table.getFilteredSelectedRowModel().rows.map((row)=> row.original as TDataWithId).map((row:any)=> row.wallet).filter(Boolean);
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await addUsersToWhitelist(wallets);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
    }

    async function commitAddSelectedToAdmin() {
        const wallets = table.getFilteredSelectedRowModel().rows.map((row)=> row.original as TDataWithId).map((row:any)=> row.wallet).filter(Boolean);
        setUploadStatus({ status: "success", message: "", isLoading: true });
        await addUsersToAdmin(wallets);
        setUploadStatus({ status: "success", message: "", isLoading: false });
        router.refresh();
    }

    return (
        <div className="space-y-4">
            <div className="flex gap-4 text-black flex-wrap">
                {Object.values(rowSelection).some(Boolean) ? (
                    <>
                        {/* Selected state buttons */}
                        <Button variant="outline" onClick={() => commitAddSelectedToWhitelist()}>
                            {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="loading" /> : "Add Selected to Whitelist"}
                        </Button>
                        <Button variant="outline" onClick={() => commitRemoveFromWhitelist()}>
                            {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="loading" /> : "Remove Selected from Whitelist"}
                        </Button>

                        {/* Admin selected buttons */}
                        <Button variant="outline" onClick={() => commitAddSelectedToAdmin()}>
                            {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="loading" /> : "Add Selected to Admin"}
                        </Button>
                        <Button variant="outline" onClick={() => commitRemoveFromAdmin()}>
                            {uploadStatus.isLoading ? <img className="w-4 h-4" src="/spinner.svg" alt="loading" /> : "Remove Selected from Admin"}
                        </Button>
                    </>
                ) : (
                    <>
                        {/* Default state buttons */}
                        <AddWhitelistDialog />
                        <RemoveWhitelistDialog />
                        <AddAdminDialog />
                        <RemoveAdminDialog />
                    </>
                )}
            </div>

            {uploadStatus.status === "error" && <p className="text-red-500">{uploadStatus.message}</p>}
            <div className="rounded-md border border-black bg-white">
                <Table >
                    <TableHeader className="color-white">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                // data-state={row.getIsSelected() && "selected"}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
