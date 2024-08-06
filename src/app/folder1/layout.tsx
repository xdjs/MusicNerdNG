export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div> 
        <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Nobis, quam alias. Impedit quisquam temporibus voluptate earum esse praesentium dignissimos fuga!</p>
        {children}
    </div>
  );
}
